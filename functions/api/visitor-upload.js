// POST /api/visitor-upload  →  a visitor (no login) adds a file to a file
// stack the owner opened with "Anyone can upload". Body: the file as base64
// text. Headers: X-Stack-Tag, X-Stack-Page, X-Stack-Block, X-File-Name (URI-encoded).
import { json } from '../../lib/http.js';
import { sameOrigin } from '../../lib/auth.js';
import { githubProblem, GitHubError } from '../../lib/github.js';
import { errorResponse, LabelError } from '../../lib/labels.js';
import { visitorUpload } from '../../lib/visitor.js';

export async function onRequestPost({ request, env }) {
  // Only from the label page itself (a POST always carries an Origin).
  if (!request.headers.get('Origin') || !sameOrigin(request)) return json({ error: 'Request blocked.' }, 403);
  if (githubProblem(env)) return json({ error: 'Uploading isn\'t available right now.' }, 503);
  const h = (k) => request.headers.get(k) || '';
  let name = '';
  try { name = decodeURIComponent(h('X-File-Name')); } catch (e) { /* cleaned later */ }
  try {
    const file = await visitorUpload(env, request, { tag: h('X-Stack-Tag'), page: h('X-Stack-Page'), block: h('X-Stack-Block'), name },
      request.body, Number(h('Content-Length') || 0));
    return json({ ok: true, file });
  } catch (e) {
    // Visitors get plain messages, never the owner's setup instructions.
    if (e instanceof LabelError) return errorResponse(e);
    if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
      return json({ error: 'The label was busy. Try again in a moment.' }, 409);
    }
    return json({ error: 'Couldn\'t upload right now. Try again in a little while.' }, 502);
  }
}
