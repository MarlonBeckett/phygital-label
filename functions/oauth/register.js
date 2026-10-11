// POST /oauth/register  { redirect_uris, client_name }  →  a client id (dynamic client registration)
// The client id is signed and holds the redirect addresses, so nothing is stored.
import { passwordProblem } from '../../lib/auth.js';
import { seal, redirectProblem, oauthJson, preflight, MAX_REDIRECTS_LENGTH } from '../../lib/oauth.js';

export async function onRequestPost({ request, env }) {
  if (passwordProblem(env)) return oauthJson({ error: 'server_error', error_description: 'The site is not set up yet.' }, 500);
  let body;
  try { body = await request.json(); } catch (e) { body = null; }
  const uris = body && Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (uris.length < 1 || uris.length > 5 || uris.some((u) => typeof u !== 'string' || u.length > 500)) {
    return oauthJson({ error: 'invalid_redirect_uri', error_description: 'Send 1 to 5 redirect_uris.' }, 400);
  }
  if (uris.join('').length > MAX_REDIRECTS_LENGTH) {
    return oauthJson({ error: 'invalid_redirect_uri', error_description: 'The redirect_uris are too long.' }, 400);
  }
  for (const u of uris) {
    const problem = redirectProblem(u);
    if (problem) return oauthJson({ error: 'invalid_redirect_uri', error_description: `${u}: ${problem}` }, 400);
  }
  const name = typeof body.client_name === 'string' ? body.client_name.trim().slice(0, 60) : '';
  const clientId = await seal(env, 'client', { r: uris, n: name });
  return oauthJson({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name || undefined,
    redirect_uris: uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code']
  }, 201);
}
export const onRequestOptions = preflight;
