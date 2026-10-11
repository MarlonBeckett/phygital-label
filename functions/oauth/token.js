// POST /oauth/token  →  swaps an authorization code (with PKCE) or a refresh token for an access token
import { passwordProblem } from '../../lib/auth.js';
import { unseal, sha256url, issueTokens, resourceUrl, oauthJson, preflight } from '../../lib/oauth.js';

const fail = (error, description, status = 400) => oauthJson({ error, error_description: description }, status);

async function readForm(request) {
  const type = request.headers.get('Content-Type') || '';
  try {
    if (type.includes('application/json')) return new Map(Object.entries(await request.json()));
    return new Map(new URLSearchParams(await request.text()));
  } catch (e) {
    return new Map();
  }
}

export async function onRequestPost({ request, env }) {
  if (passwordProblem(env)) return fail('server_error', 'The site is not set up yet.', 500);
  const form = await readForm(request);
  const get = (k) => (typeof form.get(k) === 'string' ? form.get(k) : '');
  const grant = get('grant_type');

  if (grant === 'authorization_code') {
    const code = await unseal(env, 'code', get('code'));
    if (!code) return fail('invalid_grant', 'The code is wrong or has expired. Connect again.');
    if (get('client_id') !== code.client) return fail('invalid_grant', 'The code was issued to another app (client_id is required).');
    if (get('redirect_uri') !== code.redirect) return fail('invalid_grant', 'redirect_uri does not match.');
    const verifier = get('code_verifier');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || (await sha256url(verifier)) !== code.challenge) {
      return fail('invalid_grant', 'PKCE check failed.');
    }
    return oauthJson(await issueTokens(env, request, await sha256url(code.client)));
  }

  if (grant === 'refresh_token') {
    const refresh = await unseal(env, 'refresh', get('refresh_token'));
    if (!refresh || refresh.aud !== resourceUrl(request)) return fail('invalid_grant', 'The refresh token is wrong or has expired. Connect again.');
    const clientId = get('client_id');
    if (clientId && (await sha256url(clientId)) !== refresh.c) return fail('invalid_grant', 'The token was issued to another app.');
    return oauthJson(await issueTokens(env, request, refresh.c));
  }

  return fail('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

export const onRequestOptions = preflight;
