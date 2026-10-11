// POST /api/visitor-edit  { tag, page, block, was, text }
// A visitor (no login) saves a note the owner marked "Anyone can edit".
import { json } from '../../lib/http.js';
import { sameOrigin } from '../../lib/auth.js';
import { githubProblem, GitHubError } from '../../lib/github.js';
import { errorResponse, LabelError } from '../../lib/labels.js';
import { visitorEdit, MAX_BODY_BYTES } from '../../lib/visitor.js';

export async function onRequestPost({ request, env }) {
  // Only from the label page itself (a POST always carries an Origin).
  if (!request.headers.get('Origin') || !sameOrigin(request)) return json({ error: 'Request blocked.' }, 403);
  if (githubProblem(env)) return json({ error: 'Editing isn\'t available right now.' }, 503);
  // Size checked before reading anything, so a huge body costs nothing.
  const length = Number(request.headers.get('Content-Length') || 0);
  if (!length || length > MAX_BODY_BYTES) return json({ error: 'That note is too long.' }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'That note is too long.' }, 413);
  let input = null;
  try { input = JSON.parse(raw); } catch (e) { /* checked below */ }
  try {
    return json({ ok: true, ...(await visitorEdit(env, request, input)) });
  } catch (e) {
    // Visitors get plain messages, never the owner's setup instructions.
    if (e instanceof LabelError) return errorResponse(e);
    // Two visitors saving the same note at once: the second gets the usual
    // "someone changed it" message.
    if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
      return json({ error: 'Someone changed this note a moment ago. Reload the page to see it, then make your edit again.', changed: true }, 409);
    }
    return json({ error: 'Couldn\'t save right now. Try again in a little while.' }, 502);
  }
}
