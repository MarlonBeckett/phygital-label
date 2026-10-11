// GET /api/tags  →  every tag in the repo, for the main menu, plus when the
//                  GitHub token expires (so the menu can warn in time)
import { json } from '../../lib/http.js';
import { tokenStatus } from '../../lib/github.js';
import { listLabels, errorResponse, ownerGuard } from '../../lib/labels.js';

export async function onRequestGet({ request, env }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    const [tags, token] = await Promise.all([listLabels(env), tokenStatus(env).catch(() => null)]);
    return json({ tags, repo: env.GITHUB_REPO.trim(), tokenExpires: token ? token.expires : '' });
  } catch (e) {
    const res = errorResponse(e);
    const body = await res.json();
    return json({ ...body, repo: env.GITHUB_REPO.trim() }, res.status);
  }
}
