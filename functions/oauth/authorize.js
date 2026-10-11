// GET  /oauth/authorize  →  the "Allow Claude?" page
// POST /oauth/authorize  →  checks the password (or this phone's login), then
//                            sends the person back to the app with a code
import { CSP, baseHeaders } from '../../lib/http.js';
import {
  passwordProblem, hasValidSession, safeEqual, makeSessionCookie, sameOrigin,
  lockedFor, recordFailure, clearFailures, failureDelay
} from '../../lib/auth.js';
import { readClient, seal, origin, resourceUrl, CODE_SECONDS, SCOPE } from '../../lib/oauth.js';
import { esc, embossHtml } from '../../public/assets/label.js';

const FIELDS = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource', 'response_type'];

// Checks the request. Problems that make the redirect address untrustworthy
// are shown here; the rest go back to the app as OAuth errors.
async function check(request, env, p) {
  const client = await readClient(env, p.client_id);
  if (!client) return { page: 'This connection link is not valid. Start connecting again from the app.' };
  if (!client.redirectUris.includes(p.redirect_uri)) return { page: 'The app sent an unexpected return address. Start connecting again from the app.' };
  if (p.response_type !== 'code') return { client, error: 'unsupported_response_type' };
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return { client, error: 'invalid_request' };
  if (p.resource && p.resource !== resourceUrl(request) && p.resource !== origin(request)) return { client, error: 'invalid_target' };
  return { client };
}

function backTo(p, params) {
  const u = new URL(p.redirect_uri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (p.state) u.searchParams.set('state', p.state);
  return u.toString();
}

function redirect(location, extra = {}) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...extra } });
}

function tape(text, cls) {
  return `<span class="tm-tape ${cls}"><span class="lt-letters" aria-hidden="true">${embossHtml(text)}</span></span>`;
}

function page(request, p, { client, error = '', status = 200, message = '' }) {
  const host = p.redirect_uri ? (() => { try { return new URL(p.redirect_uri).host; } catch (e) { return ''; } })() : '';
  const back = (() => { try { return new URL(p.redirect_uri).origin; } catch (e) { return ''; } })();
  const hidden = FIELDS.map((k) => `<input type="hidden" name="${k}" value="${esc(p[k] || '')}">`).join('');
  const body = message
    ? `<section class="tm-card tm-login-card tm-stack"><p class="tm-hint tm-hint-lg">${esc(message)}</p></section>`
    : `<form method="post" action="/oauth/authorize" class="tm-card tm-login-card" novalidate>
    ${hidden}
    <h2 class="tm-h2">Connect ${esc(client.name)}?</h2>
    <p class="tm-hint tm-hint-lg"><strong>${esc(client.name)}</strong> wants to see, make, change and delete the labels on <strong>${esc(new URL(request.url).host)}</strong>. You'll go back to <span class="tm-code">${esc(host)}</span> after.</p>
    <div id="pw-field" class="tm-field">
      <label for="pw" class="tm-label">Password</label>
      <input id="pw" name="password" type="password" autocomplete="current-password" class="tm-input tm-mono" placeholder="••••••••••••••••">
    </div>
    <p id="pw-ok" class="tm-hint" hidden>This phone is unlocked, so no password is needed.</p>
    ${error ? `<p class="tm-error" role="alert">${esc(error)}</p>` : ''}
    <button type="submit" name="decision" value="allow" class="tm-tape tm-tape-btn" aria-label="Allow"><span class="lt-letters" aria-hidden="true">${embossHtml('Allow')}</span></button>
    <button type="submit" name="decision" value="deny" class="tm-btn tm-btn-plain">Don't allow</button>
  </form>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#E4E2DC">
<title>Connect to the phygital label maker</title>
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/label.css">
<link rel="stylesheet" href="/assets/editor.css">
<script src="/assets/authorize.js" defer></script>
</head>
<body class="tm tm-board">
<main class="tm-login">
  <h1 class="tm-name" aria-label="Phygital label maker">${tape('Phygital', 'tm-tape-xl')}${tape('Label maker', 'tm-tape-md')}</h1>
  ${body}
</main>
</body>
</html>`;
  // The form posts here, then the browser is redirected to the app, so the
  // app's address must be allowed as a form target too.
  const csp = back ? CSP.replace("form-action 'self'", `form-action 'self' ${back}`) : CSP;
  return new Response(html, {
    status,
    headers: baseHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp })
  });
}

function params(source) {
  const p = {};
  for (const k of FIELDS) {
    const v = source.get(k);
    p[k] = typeof v === 'string' ? v.slice(0, 2000) : '';
  }
  return p;
}

export async function onRequestGet({ request, env }) {
  const p = params(new URL(request.url).searchParams);
  if (passwordProblem(env)) return page(request, p, { message: 'The site is not set up yet: ADMIN_PASSWORD is missing or too short.', status: 500 });
  const { client, error, page: problem } = await check(request, env, p);
  if (problem) return page(request, p, { message: problem, status: 400 });
  if (error) return redirect(backTo(p, { error, iss: origin(request) }));
  return page(request, p, { client });
}

export async function onRequestPost({ request, env }) {
  if (passwordProblem(env)) return new Response('Not set up', { status: 500 });
  if (!sameOrigin(request)) return new Response('Request blocked.', { status: 403 });
  const form = new URLSearchParams(await request.text());
  const p = params(form);
  const { client, error, page: problem } = await check(request, env, p);
  if (problem) return page(request, p, { message: problem, status: 400 });
  if (error) return redirect(backTo(p, { error, iss: origin(request) }));
  if (form.get('decision') !== 'allow') return redirect(backTo(p, { error: 'access_denied', iss: origin(request) }));

  // Either this phone is already unlocked, or the password must be right.
  let cookie = {};
  if (!(await hasValidSession(request, env))) {
    const wait = lockedFor(request);
    if (wait > 0) {
      const minutes = Math.ceil(wait / 60000);
      return page(request, p, { client, status: 429, error: `Too many wrong tries. Wait ${minutes} minute${minutes === 1 ? '' : 's'}, then try again.` });
    }
    const password = String(form.get('password') || '').slice(0, 256);
    if (!(await safeEqual(password, env.ADMIN_PASSWORD))) {
      recordFailure(request);
      await failureDelay();
      return page(request, p, { client, status: 401, error: 'Wrong password. Wait a few seconds, then try again.' });
    }
    clearFailures(request);
    cookie = { 'Set-Cookie': await makeSessionCookie(env) };
  }

  const code = await seal(env, 'code', {
    client: p.client_id, redirect: p.redirect_uri, challenge: p.code_challenge, scope: SCOPE
  }, CODE_SECONDS);
  return redirect(backTo(p, { code, iss: origin(request) }), cookie);
}
