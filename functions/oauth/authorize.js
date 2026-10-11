// GET  /oauth/authorize  →  the "Allow Claude?" page
// POST /oauth/authorize  →  checks the password, then sends the person back
//                            to the app with a code
//
// The password is always asked for here, even on an unlocked phone: anyone
// can register an app, so one stray tap must never hand out access.
import { CSP, baseHeaders } from '../../lib/http.js';
import {
  passwordProblem, safeEqual, makeSessionCookie, sameOrigin,
  startAttempt, clearFailures, failureDelay
} from '../../lib/auth.js';
import { readClient, seal, origin, resourceUrl, isClaudeRedirect, CODE_SECONDS, SCOPE, MAX_CLIENT_ID } from '../../lib/oauth.js';
import { esc, embossHtml } from '../../public/assets/label.js';

const FIELDS = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource', 'response_type'];

// Checks the request. Nothing redirects before the person has chosen, so a
// bad request is shown here instead of bouncing them to another site.
async function check(request, env, p) {
  const client = await readClient(env, p.client_id);
  if (!client) return { problem: 'This connection link is not valid. Start connecting again from the app.' };
  if (!client.redirectUris.includes(p.redirect_uri)) return { problem: 'The app sent an unexpected return address. Start connecting again from the app.' };
  if (p.response_type !== 'code') return { problem: 'The app asked for an unsupported kind of sign-in. Start connecting again from the app.' };
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return { problem: 'The app did not send a security check (PKCE). Start connecting again from the app.' };
  if (p.resource && p.resource !== resourceUrl(request) && p.resource !== origin(request)) return { problem: 'The app asked for access to a different site. Start connecting again from the app.' };
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
  let back = '';
  let host = '';
  try { const u = new URL(p.redirect_uri); back = u.origin; host = u.host; } catch (e) { /* shown as a message */ }
  const hidden = FIELDS.map((k) => `<input type="hidden" name="${k}" value="${esc(p[k] || '')}">`).join('');
  const unusual = client && !isClaudeRedirect(p.redirect_uri)
    ? `<p class="tm-error"><strong>Careful:</strong> this doesn't go back to Claude's usual address. Only allow it if you started connecting from an app you trust.</p>`
    : '';
  const body = message
    ? `<section class="tm-card tm-login-card tm-stack"><p class="tm-hint tm-hint-lg">${esc(message)}</p></section>`
    : `<form method="post" action="/oauth/authorize" class="tm-card tm-login-card" novalidate>
    ${hidden}
    <h2 class="tm-h2">Connect ${esc(client.name)}?</h2>
    <p class="tm-hint tm-hint-lg"><strong>${esc(client.name)}</strong> wants to see, make, change and delete the labels on <strong>${esc(new URL(request.url).host)}</strong>. Access goes to <span class="tm-code">${esc(host)}</span>.</p>
    ${unusual}
    <div class="tm-field">
      <label for="pw" class="tm-label">Password</label>
      <input id="pw" name="password" type="password" autocomplete="current-password" class="tm-input tm-mono" placeholder="••••••••••••••••" required>
    </div>
    ${error ? `<p class="tm-error" role="alert">${esc(error)}</p>` : ''}
    <button type="submit" name="decision" value="allow" class="tm-tape tm-tape-btn" aria-label="Allow"><span class="lt-letters" aria-hidden="true">${embossHtml('Allow')}</span></button>
    <button type="submit" name="decision" value="deny" class="tm-btn tm-btn-plain" formnovalidate>Don't allow</button>
  </form>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#E4E2DC">
<title>Connect to the phygital label maker</title>
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/label.css">
<link rel="stylesheet" href="/assets/editor.css">
</head>
<body class="tm tm-board">
<main class="tm-login">
  <h1 class="tm-name" aria-label="Phygital label maker">${tape('Phygital', 'tm-tape-xl')}${tape('Label maker', 'tm-tape-md')}</h1>
  ${body}
</main>
</body>
</html>`;
  // The form posts here, then the browser is redirected to the app, so the
  // app's address must be allowed as a form target too. (Registration only
  // accepts plain host names, so `back` can't smuggle in other CSP rules.)
  const csp = back && client ? CSP.replace("form-action 'self'", `form-action 'self' ${back}`) : CSP;
  return new Response(html, {
    status,
    headers: baseHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // The URL holds the sign-in request; don't leak it to other sites.
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': csp
    })
  });
}

function params(source) {
  const p = {};
  for (const k of FIELDS) {
    const v = source.get(k);
    p[k] = typeof v === 'string' ? v.slice(0, MAX_CLIENT_ID) : '';
  }
  return p;
}

export async function onRequestGet({ request, env }) {
  const p = params(new URL(request.url).searchParams);
  if (passwordProblem(env)) return page(request, p, { message: 'The site is not set up yet: ADMIN_PASSWORD is not set.', status: 500 });
  const { client, problem } = await check(request, env, p);
  if (problem) return page(request, p, { message: problem, status: 400 });
  return page(request, p, { client });
}

export async function onRequestPost({ request, env }) {
  if (passwordProblem(env)) return new Response('Not set up', { status: 500 });
  if (!sameOrigin(request)) return new Response('Request blocked.', { status: 403 });
  const form = new URLSearchParams(await request.text());
  const p = params(form);
  const { client, problem } = await check(request, env, p);
  if (problem) return page(request, p, { message: problem, status: 400 });
  // Declining is the person's own choice, so sending them back is expected.
  if (form.get('decision') !== 'allow') return redirect(backTo(p, { error: 'access_denied', iss: origin(request) }));

  const wait = startAttempt(request);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60000);
    return page(request, p, { client, status: 429, error: `Too many wrong tries. Wait ${minutes} minute${minutes === 1 ? '' : 's'}, then try again.` });
  }
  const password = String(form.get('password') || '').slice(0, 256);
  if (!(await safeEqual(password, env.ADMIN_PASSWORD))) {
    await failureDelay();
    return page(request, p, { client, status: 401, error: 'Wrong password. Wait a few seconds, then try again.' });
  }
  clearFailures(request);

  const code = await seal(env, 'code', {
    client: p.client_id, redirect: p.redirect_uri, challenge: p.code_challenge, scope: SCOPE
  }, CODE_SECONDS);
  return redirect(backTo(p, { code, iss: origin(request) }), { 'Set-Cookie': await makeSessionCookie(env, request) });
}
