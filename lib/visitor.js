// Edits by visitors (no login) to notes the owner marked "Anyone can edit".
// Protected by limits instead of a password:
//   - only editable text blocks, shown as plain text (no links), ≤ 1,000 chars
//   - the edit must come from the page itself (same-origin)
//   - "was": the text the visitor started from must still be there, so an
//     edit never silently replaces someone else's newer one
//   - a few edits per hour per person, and a daily cap for the whole site
//     (each edit is a commit, and so a Cloudflare deploy: 500 a month free)

import { readTag, writeTag, recentCommitMessages } from './github.js';
import { clientKey } from './auth.js';
import { LabelError } from './labels.js';
import { isSlug, validateTag, cleanVisitorText, LIMITS } from '../public/assets/label.js';

export const EDITS_PER_HOUR = 6;      // saved edits per person
export const ATTEMPTS_PER_HOUR = 30;  // tries per person, saved or not
// 10 a day keeps visitor edits under ~300 deploys a month, well inside the
// free plan's 500 with room for the owner's own saves.
export const EDITS_PER_DAY = 10;
export const COMMIT_PREFIX = 'Visitor edit on /';
export const MAX_BODY_BYTES = 20000;

// Per person, kept in memory (best effort: resets when Cloudflare starts a
// fresh copy of the function). The daily cap below is the firm limit.
const HOUR = 60 * 60 * 1000;
const attempts = new Map();
const saves = new Map();

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

// The deployed copy (no GitHub call): is that block an editable note?
async function editableInDeployedCopy(env, request, tagSlug, pageSlug, index) {
  try {
    const res = await env.ASSETS.fetch(new URL(`/tags/${tagSlug}.json`, request.url));
    if (!res.ok) return false;
    const tag = await res.json();
    const page = Array.isArray(tag.pages) ? tag.pages.find((p) => (p.slug || '') === pageSlug) : null;
    const block = page && Array.isArray(page.blocks) ? page.blocks[index] : null;
    return !!block && block.type === 'text' && block.editable === true;
  } catch (e) {
    return false;
  }
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
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const today = (await recentCommitMessages(env, since)).filter((m) => m.startsWith(COMMIT_PREFIX)).length;
  if (today >= EDITS_PER_DAY) throw new LabelError(429, 'This site has had a lot of edits today. Try again tomorrow.');

  block.text = text;
  const { ok, tag } = validateTag(found.tag);
  if (!ok) throw new LabelError(400, 'That edit could not be saved.');
  await writeTag(env, tagSlug, tag, found.sha, `${COMMIT_PREFIX}${tagSlug}`);
  mine.push(Date.now()); // only saved edits count towards the hourly limit
  return { text };
}
