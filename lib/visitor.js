// Edits by visitors (no login) to notes the owner marked "Anyone can edit".
// Protected by limits instead of a password:
//   - only editable text blocks, shown as plain text (no links), ≤ 1,000 chars
//   - the edit must come from the page itself (same-origin)
//   - "was": the text the visitor started from must still be there, so an
//     edit never silently replaces someone else's newer one
//   - a few edits per hour per person, and a daily cap for the whole site
//     (each edit is a commit, and so a Cloudflare deploy: 500 a month free)

import { readTag, writeTag, recentCommitMessages, getHead, readTagAt, createBlobStream, commitChanges, tagPath, GitHubError } from './github.js';
import { newId } from './files.js';
import { clientKey } from './auth.js';
import { LabelError } from './labels.js';
import { readAsset } from './assets.js';
import { isSlug, validateTag, cleanVisitorText, LIMITS, safeFileName, canBePublic, fileExtension, fileKind, formatBytes } from '../public/assets/label.js';

export const EDITS_PER_HOUR = 6;      // saved edits per person
export const ATTEMPTS_PER_HOUR = 30;  // tries per person, saved or not
// 10 a day keeps visitor edits under ~300 deploys a month, well inside the
// free plan's 500 with room for the owner's own saves.
export const EDITS_PER_DAY = 10;
export const COMMIT_PREFIX = 'Visitor edit on /';
export const UPLOAD_PREFIX = 'Visitor upload to /';
export const UPLOADS_PER_HOUR = 3;    // files per person
// Git keeps every file forever (even deleted ones stay in the history), so
// visitors get smaller files and a daily total for the whole site.
export const VISITOR_FILE_BYTES = 5 * 1024 * 1024;
export const VISITOR_BYTES_PER_DAY = 25 * 1024 * 1024;
export const MAX_BODY_BYTES = 20000;

// Per person, kept in memory (best effort: resets when Cloudflare starts a
// fresh copy of the function). The daily cap below is the firm limit.
const HOUR = 60 * 60 * 1000;
const attempts = new Map();
const saves = new Map();
const uploads = new Map();

function recentTimes(map, key, now) {
  const times = (map.get(key) || []).filter((t) => now - t < HOUR);
  map.set(key, times);
  if (map.size > 5000) map.delete(map.keys().next().value);
  return times;
}

// Counted before anything reaches GitHub, so failed tries can't burn the
// owner's GitHub allowance either.
function allowAttempt(request) {
  const times = recentTimes(attempts, clientKey(request), Date.now());
  if (times.length >= ATTEMPTS_PER_HOUR) return false;
  times.push(Date.now());
  return true;
}

// A block in the deployed copy (no GitHub call), or null.
async function deployedBlock(env, request, tagSlug, pageSlug, index) {
  try {
    const res = await readAsset(env, request, `/tags/${tagSlug}.json`);
    if (!res.ok) return null;
    const tag = await res.json();
    const page = Array.isArray(tag.pages) ? tag.pages.find((p) => (p.slug || '') === pageSlug) : null;
    return (page && Array.isArray(page.blocks) && page.blocks[index]) || null;
  } catch (e) {
    return null;
  }
}

async function editableInDeployedCopy(env, request, tagSlug, pageSlug, index) {
  const block = await deployedBlock(env, request, tagSlug, pageSlug, index);
  return !!block && block.type === 'text' && block.editable === true;
}

const isStack = (block) => !!block && block.type === 'files' && block.uploads === true;

// Visitor edits and uploads in the last 24 hours (the firm caps): how many,
// and how many bytes were uploaded (each upload's size is in its message).
async function visitorActivityToday(env) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const mine = (await recentCommitMessages(env, since)).filter((m) => m.startsWith(COMMIT_PREFIX) || m.startsWith(UPLOAD_PREFIX));
  const bytes = mine.reduce((sum, m) => sum + Number((m.match(/\((\d+) bytes\)/) || [])[1] || 0), 0);
  return { count: mine.length, bytes };
}
async function visitorChangesToday(env) {
  return (await visitorActivityToday(env)).count;
}

export async function visitorEdit(env, request, input) {
  const tagSlug = String((input && input.tag) || '');
  const pageSlug = String((input && input.page) || '');
  const index = input && Number.isInteger(input.block) ? input.block : -1;
  const was = typeof (input && input.was) === 'string' ? input.was : null;
  if (!isSlug(tagSlug) || (pageSlug && !isSlug(pageSlug)) || index < 0 || was === null || typeof input.text !== 'string') {
    throw new LabelError(400, 'That edit could not be read. Reload the page and try again.');
  }
  const text = cleanVisitorText(input.text);
  if (text.length > LIMITS.editableText) throw new LabelError(400, `Notes can be up to ${LIMITS.editableText} characters. This is ${text.length}.`);
  if (!allowAttempt(request)) throw new LabelError(429, 'That\'s a lot of tries. Try again in an hour.');
  if (!(await editableInDeployedCopy(env, request, tagSlug, pageSlug, index))) {
    throw new LabelError(403, 'This note can\'t be edited. Reload the page to see the latest version.');
  }

  const found = await readTag(env, tagSlug);
  const page = found && Array.isArray(found.tag.pages) ? found.tag.pages.find((p) => (p.slug || '') === pageSlug) : null;
  const block = page && Array.isArray(page.blocks) ? page.blocks[index] : null;
  if (!block || block.type !== 'text' || block.editable !== true) {
    throw new LabelError(403, 'This note can\'t be edited. Reload the page to see the latest version.');
  }
  if (cleanVisitorText(block.text) !== cleanVisitorText(was)) {
    // Send the newer text, so the page can show it (it may not be deployed yet).
    throw new LabelError(409, 'Someone changed this note a moment ago. Here\'s the latest version: make your edit again.', { changed: true, current: block.text });
  }
  if (text === cleanVisitorText(block.text)) return { text, unchanged: true };

  const mine = recentTimes(saves, clientKey(request), Date.now());
  if (mine.length >= EDITS_PER_HOUR) throw new LabelError(429, 'That\'s a lot of edits. Try again in an hour.');
  if ((await visitorChangesToday(env)) >= EDITS_PER_DAY) throw new LabelError(429, 'This site has had a lot of edits today. Try again tomorrow.');

  block.text = text;
  const { ok, tag } = validateTag(found.tag);
  if (!ok) throw new LabelError(400, 'That edit could not be saved.');
  await writeTag(env, tagSlug, tag, found.sha, `${COMMIT_PREFIX}${tagSlug}`);
  mine.push(Date.now()); // only saved edits count towards the hourly limit
  return { text };
}

// A visitor adds a file to a file stack the owner opened ("Anyone can
// upload"). The file and the updated label are one commit (one deploy),
// built on exactly the label version read, so nothing is overwritten.
// `base64` streams from the browser straight to GitHub (see createBlobStream).
export async function visitorUpload(env, request, meta, base64, length) {
  const tagSlug = String(meta.tag || '');
  const pageSlug = String(meta.page || '');
  const index = /^\d{1,3}$/.test(String(meta.block)) ? Number(meta.block) : -1;
  if (!isSlug(tagSlug) || (pageSlug && !isSlug(pageSlug)) || index < 0 || !base64) {
    throw new LabelError(400, 'That upload could not be read. Reload the page and try again.');
  }
  if (!length || length % 4 !== 0) throw new LabelError(400, 'That upload was cut off. Try again.');
  const size = (length / 4) * 3;
  if (size > VISITOR_FILE_BYTES + 2) throw new LabelError(413, `Files can be up to ${formatBytes(VISITOR_FILE_BYTES)} here. This one is ${formatBytes(size)}.`);
  const name = safeFileName(meta.name);
  if (!canBePublic(name)) {
    throw new LabelError(400, `${fileExtension(name) ? `.${fileExtension(name)} files` : 'Files without an extension'} can't be added here. Try a photo, PDF or document.`);
  }

  if (!allowAttempt(request)) throw new LabelError(429, 'That\'s a lot of tries. Try again in an hour.');
  if (!isStack(await deployedBlock(env, request, tagSlug, pageSlug, index))) {
    throw new LabelError(403, 'Files can\'t be added here. Reload the page to see the latest version.');
  }
  const mine = recentTimes(uploads, clientKey(request), Date.now());
  if (mine.length >= UPLOADS_PER_HOUR) throw new LabelError(429, 'That\'s a lot of uploads. Try again in an hour.');
  const today = await visitorActivityToday(env);
  if (today.count >= EDITS_PER_DAY) throw new LabelError(429, 'This site has had a lot of changes today. Try again tomorrow.');
  if (today.bytes + size > VISITOR_BYTES_PER_DAY) throw new LabelError(429, 'This site has had a lot of uploads today. Try again tomorrow.');

  const id = newId();
  const ref = `${id}/${name}`;
  let blobSha = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await getHead(env);
    const raw = await readTagAt(env, tagSlug, head.sha);
    const page = raw && Array.isArray(raw.pages) ? raw.pages.find((p) => (p.slug || '') === pageSlug) : null;
    const block = page && Array.isArray(page.blocks) ? page.blocks[index] : null;
    if (!isStack(block)) throw new LabelError(403, 'Files can\'t be added here any more. Reload the page.');
    const list = Array.isArray(block.files) ? block.files : [];
    if (list.length >= LIMITS.stack) throw new LabelError(409, 'This file stack is full.');
    block.files = [...list, ref];
    const { ok, tag } = validateTag(raw);
    if (!ok) throw new LabelError(400, 'That upload could not be added to this label.');
    if (!blobSha) {
      try {
        blobSha = await createBlobStream(env, base64, length);
      } catch (e) {
        if (e instanceof GitHubError && e.status === 422) throw new LabelError(400, 'That file arrived damaged. Try again.');
        throw e;
      }
    }
    try {
      await commitChanges(env, head, [
        { path: `public/files/${id}/${name}`, sha: blobSha },
        { path: tagPath(tagSlug), content: JSON.stringify(tag, null, 2) + '\n' }
      ], `${UPLOAD_PREFIX}${tagSlug}: ${name} (${Math.round(size)} bytes)`);
      mine.push(Date.now());
      return { ref, name, kind: fileKind(name) };
    } catch (e) {
      // Something else was saved at that moment: rebuild on the new version once.
      if (attempt === 0 && e instanceof GitHubError && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
  throw new LabelError(409, 'The label was busy. Try again.');
}
