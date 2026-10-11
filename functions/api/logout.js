// POST /api/logout  →  forgets the login on this device
import { json } from '../../lib/http.js';
import { clearSessionCookie, sameOrigin } from '../../lib/auth.js';

export function onRequestPost({ request }) {
  if (!sameOrigin(request)) return json({ error: 'Request blocked.' }, 403);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}
