// GET    /api/tag/<slug>                          →  loads a tag straight from GitHub (always the latest)
// PUT    /api/tag/<slug>  { tag, sha?, overwrite? } →  saves it to GitHub
//                          { tag, replace: true }    →  saves it, moving the label already there to /<slug>-2
// DELETE /api/tag/<slug>  { sha? }                  →  deletes it
import { json } from '../../../lib/http.js';
import { requireSession } from '../../../lib/auth.js';
import { githubProblem } from '../../../lib/github.js';
import { getLabel, saveLabel, replaceLabel, removeLabel, errorResponse, LabelError } from '../../../lib/labels.js';
import { LIMITS } from '../../../public/assets/label.js';

async function guard(request, env) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  const setup = githubProblem(env);
  if (setup) return json({ error: setup, setup: true }, 500);
  return null;
}

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > LIMITS.fileBytes * 2) throw new LabelError(413, 'This tag is too large.');
  try { return JSON.parse(raw || '{}') || {}; } catch (e) { throw new LabelError(400, 'The tag could not be read.'); }
}

export async function onRequestGet({ request, env, params }) {
  const stop = await guard(request, env);
  if (stop) return stop;
  try {
    const { slug, tag, sha, warnings } = await getLabel(env, String(params.slug || ''));
    return json({ slug, tag, sha, warnings });
  } catch (e) {
    if (e instanceof LabelError && e.extra.missing) return json({ error: `There is no tag at /${params.slug} yet.`, missing: true }, 404);
    return errorResponse(e);
  }
}

export async function onRequestPut({ request, env, params }) {
  const stop = await guard(request, env);
  if (stop) return stop;
  try {
    const body = await readBody(request);
    if (body.replace === true) return json({ ok: true, ...(await replaceLabel(env, String(params.slug || ''), body.tag)) });
    const saved = await saveLabel(env, String(params.slug || ''), body.tag, {
      sha: typeof body.sha === 'string' ? body.sha : '',
      overwrite: !!body.overwrite
    });
    return json({ ok: true, ...saved });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const stop = await guard(request, env);
  if (stop) return stop;
  try {
    const body = await readBody(request);
    await removeLabel(env, String(params.slug || ''), typeof body.sha === 'string' ? body.sha : '');
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
