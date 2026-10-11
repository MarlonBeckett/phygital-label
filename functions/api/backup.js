// GET /api/backup  →  every tag in one JSON file, as a download
import { json, baseHeaders } from '../../lib/http.js';
import { listTags } from '../../lib/github.js';
import { errorResponse, ownerGuard } from '../../lib/labels.js';
import { readSettingsFile } from '../../lib/settings.js';

export async function onRequestGet({ request, env }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    const [files, { settings }] = await Promise.all([listTags(env), readSettingsFile(env)]);
    const now = new Date();
    const backup = {
      kind: 'phygital-label-backup',
      v: 1,
      site: new URL(request.url).host,
      exported: now.toISOString(),
      settings: { font: settings.font },
      tags: Object.fromEntries(files.map((f) => [f.slug, f.tag]))
    };
    const name = `labels-backup-${now.toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(backup, null, 2) + '\n', {
      headers: baseHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store'
      })
    });
  } catch (e) {
    return errorResponse(e);
  }
}
