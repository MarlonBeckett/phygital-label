// POST /api/reset-access  →  "Sign out everywhere": once the site redeploys,
// every unlocked phone and every connected app (Claude) has to sign in again.
import { json } from '../../lib/http.js';
import { clearSessionCookie } from '../../lib/auth.js';
import { errorResponse, ownerGuard } from '../../lib/labels.js';
import { readSettingsFile, writeSettingsFile } from '../../lib/settings.js';

export async function onRequestPost({ request, env }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    const { settings, sha } = await readSettingsFile(env);
    await writeSettingsFile(env, { ...settings, epoch: settings.epoch + 1 }, sha, 'Sign out everywhere');
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  } catch (e) {
    return errorResponse(e);
  }
}
