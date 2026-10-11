// Uploaded files, kept in the repo like labels, at public/files/<id>/<name>
// and on the website at /files/<id>/<name>. They're all public: a file is on
// a label, and anyone with the sticker can open it. The 16-character random
// id keeps addresses unguessable. Files no label uses are deleted when a
// label is saved or deleted (see lib/labels.js).

import { putFileStream, getRawFile, listUploads, listTags } from './github.js';
import { LabelError, fileRefs } from './labels.js';
import { MAX_FILE_BYTES, FILE_REF_RE, fileExtension, fileKind, safeFileName, formatBytes, canBePublic } from '../public/assets/label.js';

export const filePath = (id, name) => `public/files/${id}/${name}`;

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

const notAllowed = (name) => new LabelError(400, `${fileExtension(name) ? `.${fileExtension(name)} files` : 'Files without an extension'} can't be uploaded: browsers could open them as web pages on your site. Put it in a .zip first.`, { notAllowed: true });

// Uploads one file. The browser sends it as base64 text, which streams on to
// GitHub untouched (see putFileStream). `length` is the base64 length.
export async function uploadFile(env, rawName, base64, length) {
  if (!base64 || !Number.isInteger(length) || length <= 0) throw new LabelError(400, 'That file is empty.');
  if (length % 4 !== 0) throw new LabelError(400, 'That upload was cut off. Try again.');
  const size = (length / 4) * 3; // within 2 bytes of the real size
  if (size > MAX_FILE_BYTES + 2) throw new LabelError(413, `Files can be up to ${formatBytes(MAX_FILE_BYTES)}. This one is ${formatBytes(size)}.`);
  const name = safeFileName(rawName);
  if (!canBePublic(name)) throw notAllowed(name);
  const id = newId();
  await putFileStream(env, filePath(id, name), base64, length, `Upload file ${name}`);
  return { id, name, ref: `${id}/${name}`, size, kind: fileKind(name), usedBy: [] };
}

// The file for the label maker's preview, straight from GitHub (so it works
// before the next deploy).
export async function readFile(env, id, name, download) {
  checkRef(id, name);
  const res = await getRawFile(env, filePath(id, name));
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
