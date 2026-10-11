// A small OAuth 2.1 server so Claude (or any MCP client) can connect to /mcp.
//
// There is no database, so everything is a signed token: client ids,
// authorization codes, access and refresh tokens all carry their own data
// plus an HMAC made from ADMIN_PASSWORD. Changing the password disconnects
// every client at once, and so does "Sign out everywhere" in Settings.

import { safeEqual, withEpoch } from './auth.js';
import { baseHeaders } from './http.js';

const enc = new TextEncoder();

export const SCOPE = 'labels';
export const CODE_SECONDS = 5 * 60;
export const ACCESS_SECONDS = 60 * 60;
export const REFRESH_SECONDS = 90 * 24 * 60 * 60;

export function origin(request) {
  return new URL(request.url).origin;
}
export const resourceUrl = (request) => `${origin(request)}/mcp`;

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(env, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(withEpoch('label-maker-oauth:') + env.ADMIN_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))));
}

export async function sha256url(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

// kind: 'client' | 'code' | 'access' | 'refresh'. Kinds are part of the
// signature, so one kind of token can never be used as another.
export async function seal(env, kind, payload, seconds = 0) {
  const data = { ...payload };
  if (seconds) data.exp = Math.floor(Date.now() / 1000) + seconds;
  const body = b64url(enc.encode(JSON.stringify(data)));
  return `${body}.${await hmac(env, `${kind}.${body}`)}`;
}

export async function unseal(env, kind, token) {
  if (typeof token !== 'string' || token.length > 4000) return null;
  const m = token.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  if (!(await safeEqual(m[2], await hmac(env, `${kind}.${m[1]}`)))) return null;
  let data;
  try { data = JSON.parse(fromB64url(m[1])); } catch (e) { return null; }
  if (!data || typeof data !== 'object') return null;
  if (data.exp && data.exp < Date.now() / 1000) return null;
  return data;
}

// Client ids carry their redirect addresses, so these limits keep them short
// enough to pass through the Allow page and back.
export const MAX_CLIENT_ID = 4000;
export const MAX_REDIRECTS_LENGTH = 1500;

// Where a client may send people back to: any https address, or http on
// this computer (for apps like Claude Code). The Allow page shows the host.
// Host names must be plain (letters, digits, dots, dashes, or an IPv6
// address), so they are safe to put into the page's security policy.
export function redirectProblem(uri) {
  let u;
  try { u = new URL(uri); } catch (e) { return 'not a valid address'; }
  if (u.hash) return 'must not contain #';
  if (u.username || u.password) return 'must not contain a user name or password';
  if (!/^([a-z0-9-]+\.)*[a-z0-9-]+$|^\[[0-9a-f:.]+\]$/.test(u.hostname)) return 'has an unusual host name';
  if (u.protocol === 'https:') return '';
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return '';
  return 'must be https (or http://localhost)';
}

// Claude's own sign-in return addresses, plus this computer (Claude Code).
// Anything else gets a warning on the Allow page.
export function isClaudeRedirect(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return ['claude.ai', 'claude.com'].includes(u.hostname);
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch (e) {
    return false;
  }
}

export async function readClient(env, clientId) {
  const c = await unseal(env, 'client', clientId);
  if (!c || !Array.isArray(c.r)) return null;
  return { redirectUris: c.r, name: typeof c.n === 'string' && c.n ? c.n : 'An app' };
}

// `client` is a fingerprint (hash) of the app's client id.
export async function issueTokens(env, request, client) {
  const aud = resourceUrl(request);
  return {
    access_token: await seal(env, 'access', { c: client, aud, scope: SCOPE }, ACCESS_SECONDS),
    token_type: 'Bearer',
    expires_in: ACCESS_SECONDS,
    refresh_token: await seal(env, 'refresh', { c: client, aud, scope: SCOPE }, REFRESH_SECONDS),
    scope: SCOPE
  };
}

// Returns the token's data if the request carries a valid access token for
// this site's /mcp, otherwise null.
export async function verifyBearer(request, env) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const t = await unseal(env, 'access', m[1]);
  if (!t || t.aud !== resourceUrl(request)) return null;
  return t;
}

// Discovery and token responses are read by apps, sometimes from a browser.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400'
};

export function oauthJson(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: baseHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
      ...extra
    })
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export function authorizationServerMetadata(request) {
  const o = origin(request);
  return {
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE]
  };
}

export function protectedResourceMetadata(request) {
  return {
    resource: resourceUrl(request),
    authorization_servers: [origin(request)],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Phygital label maker'
  };
}
