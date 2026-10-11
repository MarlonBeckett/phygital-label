// Password check and login cookie for the phygital label maker.

import { json, sleep } from './http.js';
import { currentSettings } from './settings.js';

const COOKIE = 'tm_session';
const SESSION_DAYS = 30;

// Best-effort guessing protection. Kept in memory, so it resets whenever
// Cloudflare starts a fresh copy of the function; the long password and the
// delay after every wrong guess do the real work.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

const enc = new TextEncoder();

export function passwordProblem(env) {
  const pw = env.ADMIN_PASSWORD;
  if (typeof pw !== 'string' || pw.length === 0) {
    return 'ADMIN_PASSWORD is not set. Add it in Cloudflare (Settings > Variables and Secrets), then redeploy.';
  }
  return '';
}

// "Sign out everywhere" bumps the epoch, which changes every signing key.
export function withEpoch(prefix) {
  const epoch = currentSettings().epoch;
  return epoch ? `${prefix}${epoch}:` : prefix;
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

// Compares two strings in constant time by comparing their hashes byte by byte.
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(env, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(withEpoch('tag-maker-session:') + env.ADMIN_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))));
}

// The login is tied to the site's address, so it can't be replayed on one of
// Cloudflare's per-deployment addresses (which keep running old versions).
const sessionMessage = (request, expires) => `v2.${new URL(request.url).host}.${expires}`;

export async function makeSessionCookie(env, request) {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const value = `${expires}.${await sign(env, sessionMessage(request, expires))}`;
  return `${COOKIE}=${value}; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export async function hasValidSession(request, env) {
  if (passwordProblem(env)) return false;
  const raw = readCookie(request, COOKIE);
  const m = raw.match(/^(\d{13})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return false;
  if (Number(m[1]) < Date.now()) return false;
  return safeEqual(m[2], await sign(env, sessionMessage(request, m[1])));
}

// Blocks requests sent from other websites (a second layer on top of the
// SameSite cookie).
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return request.method === 'GET';
  // Some browsers send "null" (e.g. under a strict referrer policy); then
  // trust only the browser's own same-origin marker.
  if (origin === 'null') return request.headers.get('Sec-Fetch-Site') === 'same-origin';
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch (e) {
    return false;
  }
}

// Use at the top of every protected API handler. Returns a Response to send
// back if the request is not allowed, or null if it may continue.
export async function requireSession(request, env) {
  const problem = passwordProblem(env);
  if (problem) return json({ error: problem, setup: true }, 500);
  if (!sameOrigin(request)) return json({ error: 'Request blocked.' }, 403);
  if (!(await hasValidSession(request, env))) return json({ error: 'Please unlock the phygital label maker again.', login: true }, 401);
  return null;
}

// One entry per IPv4 address, or per IPv6 /64 network (a home connection
// gets a whole /64, so changing address inside it doesn't reset the count).
export function clientKey(request) {
  const raw = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ip = raw.split('%')[0].toLowerCase(); // drop any zone id (fe80::1%eth0)
  if (!ip.includes(':')) return ip;
  // IPv4 written as IPv6 (::ffff:1.2.3.4): key by the IPv4 address.
  const v4 = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (!ip.includes('::') && left.length !== 8)) return ip; // not a normal address: use as is
  const groups = ip.includes('::') ? [...left, ...Array(missing).fill('0'), ...right] : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

function prune(now) {
  if (failures.size <= 5000) return;
  for (const [key, e] of failures) {
    if (e.lockedUntil <= now && now - e.first > WINDOW_MS) failures.delete(key);
  }
  // Still full: drop the oldest entries that aren't locked out.
  for (const [key, e] of failures) {
    if (failures.size <= 5000) break;
    if (e.lockedUntil <= now) failures.delete(key);
  }
}

// Call before checking a password. Returns how long this client is locked out
// for (ms), or 0 after counting the attempt. Counting first means a burst of
// parallel guesses can't all slip in before the counter catches up; a right
// password then clears the count (clearFailures).
export function startAttempt(request) {
  const key = clientKey(request);
  const now = Date.now();
  let entry = failures.get(key);
  if (entry && entry.lockedUntil > now) return entry.lockedUntil - now;
  if (!entry || now - entry.first > WINDOW_MS) entry = { first: now, count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILS) entry.lockedUntil = now + WINDOW_MS;
  failures.set(key, entry);
  prune(now);
  return 0;
}

export function clearFailures(request) {
  failures.delete(clientKey(request));
}

export async function failureDelay() {
  await sleep(1500 + Math.floor(Math.random() * 1000));
}
