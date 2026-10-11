// Site settings, kept in public/tags/_settings.json in the repo (the
// underscore means it can never be a tag address, and the raw file is never
// served publicly: /tags/* only ever shows "Nothing here").
//
//   font   'label' | 'regular'  the default text style for tags without their own
//   epoch  number               bumped by "Sign out everywhere"; every login
//                               cookie and Claude token is signed with it

import { readTag, writeTag } from './github.js';

export const SETTINGS_SLUG = '_settings';
export const DEFAULTS = { v: 1, font: 'label', epoch: 0 };

export function cleanSettings(input) {
  const s = input && typeof input === 'object' ? input : {};
  return {
    v: 1,
    font: s.font === 'regular' ? 'regular' : 'label',
    epoch: Number.isInteger(s.epoch) && s.epoch >= 0 ? s.epoch : 0
  };
}

// The deployed copy, read through the site's own static files: fast, and
// what the live site is actually using. Cached briefly per server copy.
let cache = { at: 0, value: DEFAULTS };
const CACHE_MS = 10 * 1000;

export async function loadSettings(request, env) {
  if (Date.now() - cache.at < CACHE_MS) return cache.value;
  let value = DEFAULTS;
  try {
    const res = await env.ASSETS.fetch(new URL(`/tags/${SETTINGS_SLUG}.json`, request.url));
    if (res.ok) value = cleanSettings(await res.json());
  } catch (e) { /* no settings file yet: defaults */ }
  cache = { at: Date.now(), value };
  return value;
}

// Settings as of the last loadSettings() (functions/_middleware.js loads them
// at the start of every request).
export function currentSettings() {
  return cache.value;
}

// The latest saved copy, straight from GitHub (may be ahead of the deployed
// one by a minute). Returns { settings, sha }.
export async function readSettingsFile(env) {
  const found = await readTag(env, SETTINGS_SLUG);
  return found ? { settings: cleanSettings(found.tag), sha: found.sha } : { settings: { ...DEFAULTS }, sha: '' };
}

export async function writeSettingsFile(env, settings, sha, message) {
  return writeTag(env, SETTINGS_SLUG, cleanSettings(settings), sha, message);
}
