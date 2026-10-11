// GET /api/tags  →  every tag in the repo, for the main menu, plus when the
//                  GitHub token expires (so the menu can warn in time)
import { json } from '../../lib/http.js';
import { requireSession } from '../../lib/auth.js';
import { githubProblem, tokenStatus } from '../../lib/github.js';
import { listLabels, errorResponse } from '../../lib/labels.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  const setup = githubProblem(env);
  if (setup) return json({ error: setup, setup: true }, 500);
  try {
    const [tags, token] = await Promise.all([listLabels(env), tokenStatus(env).catch(() => null)]);
    return json({ tags, repo: env.GITHUB_REPO.trim(), tokenExpires: token ? token.expires : '' });
  } catch (e) {
    const res = errorResponse(e);
    const body = await res.json();
    return json({ ...body, repo: env.GITHUB_REPO.trim() }, res.status);
  }
}
