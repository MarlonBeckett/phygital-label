// Uploaded files, kept in the repo like labels:
//   public/files/<id>/<name>   public: on the website at /files/<id>/<name>
//   files/<id>/<name>          private: never deployed; only the unlocked
//                              label maker can fetch them (through the API)
// The 16-character random id keeps public addresses unguessable.

import { putFileStream, moveFile, fileSha, getRawFile, deleteFile, listUploads, listTags } from './github.js';
import { LabelError, fileRefs } from './labels.js';
import { MAX_FILE_BYTES, FILE_REF_RE, fileExtension, fileKind, safeFileName, formatBytes, canBePublic } from '../public/assets/label.js';

export const filePath = (id, name, isPrivate) => `${isPrivate ? 'files' : 'public/files'}/${id}/${name}`;

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

function checkRef(id, name) {
  if (!FILE_REF_RE.test(`${id}/${name}`)) throw new LabelError(400, 'That isn\'t one of your uploads.');
}

// Which labels use which public file: { "<id>/<name>": ["camera", …] }.
async function usage(env) {
  const used = {};
  for (const { slug, tag } of await listTags(env)) {
    for (const ref of fileRefs(tag)) (used[ref] = used[ref] || []).push(slug);
  }
  return used;
}

export async function listFiles(env) {
  const [files, used] = await Promise.all([listUploads(env), usage(env)]);
  return files
    .filter((f) => FILE_REF_RE.test(`${f.id}/${f.name}`))
    .map((f) => ({ ...f, ref: `${f.id}/${f.name}`, kind: fileKind(f.name), usedBy: used[`${f.id}/${f.name}`] || [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const privateOnly = (name) => new LabelError(400, `${fileExtension(name) ? `.${fileExtension(name)} files` : 'Files without an extension'} can only be private (browsers could open them as web pages on your site).`, { privateOnly: true });

// Uploads one file. The browser sends it as base64 text, which streams on to
// GitHub untouched (see putFileStream). `length` is the base64 length.
export async function uploadFile(env, rawName, base64, length, isPrivate) {
  if (!base64 || !Number.isInteger(length) || length <= 0) throw new LabelError(400, 'That file is empty.');
  if (length % 4 !== 0) throw new LabelError(400, 'That upload was cut off. Try again.');
  const size = (length / 4) * 3; // within 2 bytes of the real size
  if (size > MAX_FILE_BYTES + 2) throw new LabelError(413, `Files can be up to ${formatBytes(MAX_FILE_BYTES)}. This one is ${formatBytes(size)}.`);
  const name = safeFileName(rawName);
  if (!isPrivate && !canBePublic(name)) throw privateOnly(name);
  const id = newId();
  await putFileStream(env, filePath(id, name, isPrivate), base64, length, `Upload ${isPrivate ? 'private' : 'public'} file ${name}`);
  return { id, name, ref: `${id}/${name}`, size, private: isPrivate, kind: fileKind(name), usedBy: [] };
}

// The file for the label maker's viewer, straight from GitHub (so it works
// before the next deploy, and for private files at all).
export async function readFile(env, id, name, isPrivate, download) {
  checkRef(id, name);
  const res = await getRawFile(env, filePath(id, name, isPrivate));
  if (!res) throw new LabelError(404, 'That file is gone.', { missing: true });
  const kind = fileKind(name);
  const types = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
    opus: 'audio/ogg', flac: 'audio/flac', txt: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8',
    md: 'text/plain; charset=utf-8', json: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8'
  };
  // Risky and unknown types always download as plain bytes, so a browser
  // never runs them on this site's address.
  const inline = !download && kind !== 'risky' && kind !== 'other';
  const type = inline ? (types[fileExtension(name)] || 'application/octet-stream') : 'application/octet-stream';
  return new Response(res.body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
      // Shown inside the label maker's own viewer, never anywhere else.
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  });
}

// Moves a file between public and private, in one commit and without the
// file passing through here (see moveFile). Safe to retry.
export async function setPrivate(env, id, name, fromPrivate, toPrivate) {
  checkRef(id, name);
  if (fromPrivate === toPrivate) return { id, name, private: toPrivate };
  if (!toPrivate && !canBePublic(name)) throw privateOnly(name);
  const from = filePath(id, name, fromPrivate);
  const to = filePath(id, name, toPrivate);
  const sha = await fileSha(env, from);
  if (!sha) {
    if (await fileSha(env, to)) return { id, name, private: toPrivate }; // already moved
    throw new LabelError(404, 'That file is gone.', { missing: true });
  }
  await moveFile(env, from, to, sha, `Make ${name} ${toPrivate ? 'private' : 'public'}`);
  return { id, name, private: toPrivate };
}

export async function removeFile(env, id, name, isPrivate) {
  checkRef(id, name);
  const path = filePath(id, name, isPrivate);
  const sha = await fileSha(env, path);
  if (!sha || !(await deleteFile(env, path, sha, `Delete file ${name}`))) {
    throw new LabelError(404, 'That file is already gone.', { missing: true });
  }
  return { id, name };
}
