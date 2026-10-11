// GET /api/settings[?health=1]  →  the saved site settings (and, with health, a GitHub check)
// PUT /api/settings  { font }    →  changes the default text style
import { json } from '../../lib/http.js';
import { tokenStatus } from '../../lib/github.js';
import { listLabels, errorResponse, ownerGuard } from '../../lib/labels.js';
import { readSettingsFile, writeSettingsFile } from '../../lib/settings.js';

export async function onRequestGet({ request, env }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    const { settings } = await readSettingsFile(env);
    const out = { settings: { font: settings.font } };
    if (new URL(request.url).searchParams.get('health')) {
      const [token, labels] = await Promise.all([tokenStatus(env), listLabels(env)]);
      out.health = { ...token, labels: labels.length };
    }
    return json(out);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function onRequestPut({ request, env }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  let body = {};
  try { body = (await request.json()) || {}; } catch (e) { /* checked below */ }
  if (body.font !== 'label' && body.font !== 'regular') return json({ error: 'Pick Label or Regular.' }, 400);
  try {
    const { settings, sha } = await readSettingsFile(env);
    if (settings.font === body.font) return json({ ok: true, settings: { font: settings.font } });
    await writeSettingsFile(env, { ...settings, font: body.font }, sha, `Default text style: ${body.font}`);
    return json({ ok: true, settings: { font: body.font } });
  } catch (e) {
    return errorResponse(e);
  }
}
