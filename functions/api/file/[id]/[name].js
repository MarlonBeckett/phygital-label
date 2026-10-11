// GET /api/file/<id>/<name>[?download=1]  →  the file itself, for the editor's
// preview (straight from GitHub, so it works before the site updates)
import { errorResponse, ownerGuard } from '../../../../lib/labels.js';
import { readFile } from '../../../../lib/files.js';

export async function onRequestGet({ request, env, params }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    const download = new URL(request.url).searchParams.get('download') === '1';
    return await readFile(env, String(params.id), String(params.name), download);
  } catch (e) {
    return errorResponse(e);
  }
}
