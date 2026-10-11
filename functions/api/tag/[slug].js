// GET /api/tag/<slug>  →  loads a tag straight from GitHub (always the latest)
// PUT /api/tag/<slug>  { tag, sha?, overwrite? }  →  saves it to GitHub
import { json } from '../../../lib/http.js';
import { requireSession } from '../../../lib/auth.js';
import { githubProblem, readTag, writeTag, GitHubError } from '../../../lib/github.js';
import { slugProblem, validateTag, LIMITS } from '../../../public/assets/label.js';

function checkSlug(params) {
  const slug = String(params.slug || '');
  return { slug, problem: slugProblem(slug, { isTag: true }) };
}

function fromGitHubError(e) {
  if (e instanceof GitHubError) return json({ error: e.message }, e.status === 409 || e.status === 422 ? 409 : 502);
  return json({ error: 'Could not reach GitHub. Try again in a minute.' }, 502);
}

export async function onRequestGet({ request, env, params }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  const setup = githubProblem(env);
  if (setup) return json({ error: setup, setup: true }, 500);
  const { slug, problem } = checkSlug(params);
  if (problem) return json({ error: problem }, 400);

  try {
    const found = await readTag(env, slug);
    if (!found) return json({ error: `There is no tag at /${slug} yet.`, missing: true }, 404);
    const { ok, errors, tag } = validateTag(found.tag);
    return json({ slug, tag, sha: found.sha, warnings: ok ? [] : errors });
  } catch (e) {
    return fromGitHubError(e);
  }
}

export async function onRequestPut({ request, env, params }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  const setup = githubProblem(env);
  if (setup) return json({ error: setup, setup: true }, 500);
  const { slug, problem } = checkSlug(params);
  if (problem) return json({ error: problem }, 400);

  const raw = await request.text();
  if (raw.length > LIMITS.fileBytes * 2) return json({ error: 'This tag is too large.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'The tag could not be read.' }, 400); }

  const { ok, errors, tag } = validateTag(body && body.tag);
  if (!ok) return json({ error: errors[0], errors }, 400);

  let sha = typeof body.sha === 'string' && /^[0-9a-f]{40}$/.test(body.sha) ? body.sha : '';
  try {
    if (!sha) {
      // A new tag: make sure we never silently replace an existing one.
      const existing = await readTag(env, slug);
      if (existing) {
        if (!body.overwrite) return json({ error: `A tag already exists at /${slug}.`, exists: true }, 409);
        sha = existing.sha;
      }
    }
    const newSha = await writeTag(env, slug, tag, sha);
    return json({ ok: true, slug, sha: newSha, tag });
  } catch (e) {
    return fromGitHubError(e);
  }
}
