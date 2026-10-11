// Site settings, kept in public/tags/_settings.json in the repo (the
// underscore means it can never be a tag address, and the raw file is never
// served publicly: /tags/* only ever shows "Nothing here").
//
//   font   'label' | 'regular'  the default text style for tags without their own
//   epoch  number               bumped by "Sign out everywhere"; every login
//                               cookie and Claude token is signed with it

import { readTag, writeTag } from './github.js';
import { readAsset } from './assets.js';

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
//
// A failed read never falls back to the defaults: that would reset the
// sign-in epoch and quietly undo "Sign out everywhere". Instead the last good
// copy is kept, and before any good read, sign-in is refused (settingsReady).
let cache = { at: 0, value: DEFAULTS, ok: false };
const CACHE_MS = 10 * 1000;

export async function loadSettings(request, env) {
  if (cache.ok && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const res = await readAsset(env, request, `/tags/${SETTINGS_SLUG}.json`);
    if (res.status === 404) {
      cache = { at: Date.now(), value: DEFAULTS, ok: true }; // no settings saved yet
    } else if (res.ok) {
      const data = await res.json();
      // Only a real settings object counts; anything else is a failed read.
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        cache = { at: Date.now(), value: cleanSettings(data), ok: true };
      }
    }
    // Any other answer: keep the last good copy and try again next request.
  } catch (e) { /* same: keep the last good copy */ }
  return cache.value;
}

export function settingsReady() {
  return cache.ok;
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
