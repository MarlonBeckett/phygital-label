// POST /api/reset-access  →  "Sign out everywhere": once the site redeploys,
// every unlocked phone and every connected app (Claude) has to sign in again.
import { json } from '../../lib/http.js';
import { requireSession, clearSessionCookie } from '../../lib/auth.js';
import { githubProblem } from '../../lib/github.js';
import { errorResponse } from '../../lib/labels.js';
import { readSettingsFile, writeSettingsFile } from '../../lib/settings.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  const setup = githubProblem(env);
  if (setup) return json({ error: setup, setup: true }, 500);
  try {
    const { settings, sha } = await readSettingsFile(env);
    await writeSettingsFile(env, { ...settings, epoch: settings.epoch + 1 }, sha, 'Sign out everywhere');
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  } catch (e) {
    return errorResponse(e);
  }
}
