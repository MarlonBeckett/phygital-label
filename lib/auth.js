// Password check and login cookie for the tag maker.

import { json, sleep } from './http.js';

const COOKIE = 'tm_session';
const SESSION_DAYS = 30;
const MIN_PASSWORD = 16;

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
  if (pw.length < MIN_PASSWORD) {
    return `ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters. Change it in Cloudflare, then redeploy.`;
  }
  return '';
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
    'raw', enc.encode('tag-maker-session:' + env.ADMIN_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))));
}

export async function makeSessionCookie(env) {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const value = `${expires}.${await sign(env, 'v1.' + expires)}`;
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
  return safeEqual(m[2], await sign(env, 'v1.' + m[1]));
}

// Blocks requests sent from other websites (a second layer on top of the
// SameSite cookie).
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return request.method === 'GET';
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
  if (!(await hasValidSession(request, env))) return json({ error: 'Please unlock the tag maker again.', login: true }, 401);
  return null;
}

function clientKey(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export function lockedFor(request) {
  const entry = failures.get(clientKey(request));
  if (!entry) return 0;
  const now = Date.now();
  if (entry.lockedUntil > now) return entry.lockedUntil - now;
  if (now - entry.first > WINDOW_MS) failures.delete(clientKey(request));
  return 0;
}

export function recordFailure(request) {
  const key = clientKey(request);
  const now = Date.now();
  let entry = failures.get(key);
  if (!entry || now - entry.first > WINDOW_MS) entry = { first: now, count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILS) entry.lockedUntil = now + WINDOW_MS;
  failures.set(key, entry);
  if (failures.size > 5000) failures.delete(failures.keys().next().value);
}

export function clearFailures(request) {
  failures.delete(clientKey(request));
}

export async function failureDelay() {
  await sleep(1500 + Math.floor(Math.random() * 1000));
}
