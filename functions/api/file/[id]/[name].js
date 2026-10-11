// GET    /api/file/<id>/<name>[?private=1][&download=1]  →  the file itself, for the viewer
// PATCH  /api/file/<id>/<name>  { private, wasPrivate }   →  make it public or private
// DELETE /api/file/<id>/<name>[?private=1]                 →  delete it
import { json } from '../../../../lib/http.js';
import { errorResponse, ownerGuard } from '../../../../lib/labels.js';
import { readFile, setPrivate, removeFile } from '../../../../lib/files.js';

const flag = (request, key) => new URL(request.url).searchParams.get(key) === '1';

export async function onRequestGet({ request, env, params }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    return await readFile(env, String(params.id), String(params.name), flag(request, 'private'), flag(request, 'download'));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function onRequestPatch({ request, env, params }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    let body = {};
    try { body = (await request.json()) || {}; } catch (e) { /* defaults below */ }
    return json({ ok: true, file: await setPrivate(env, String(params.id), String(params.name), body.wasPrivate === true, body.private === true) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    return json({ ok: true, file: await removeFile(env, String(params.id), String(params.name), flag(request, 'private')) });
  } catch (e) {
    return errorResponse(e);
  }
}
