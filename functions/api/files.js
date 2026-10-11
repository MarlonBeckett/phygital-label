// GET  /api/files  →  every uploaded file and which labels use it
// POST /api/files  →  upload one file. Body: the file as base64 text. Header:
//                      X-File-Name (URI-encoded)
import { json } from '../../lib/http.js';
import { errorResponse, ownerGuard, LabelError } from '../../lib/labels.js';
import { listFiles, uploadFile } from '../../lib/files.js';
import { MAX_FILE_BYTES, formatBytes } from '../../public/assets/label.js';

export async function onRequestGet({ request, env }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    return json({ files: await listFiles(env), maxBytes: MAX_FILE_BYTES });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function onRequestPost({ request, env }) {
  const stop = await ownerGuard(request, env);
  if (stop) return stop;
  try {
    // The body is the file as base64 text, streamed on to GitHub as is.
    const length = Number(request.headers.get('Content-Length') || 0);
    if (!length) throw new LabelError(411, 'The upload has no size. Try again.');
    if ((length / 4) * 3 > MAX_FILE_BYTES + 2) throw new LabelError(413, `Files can be up to ${formatBytes(MAX_FILE_BYTES)}. This one is ${formatBytes((length / 4) * 3)}.`);
    let name = '';
    try { name = decodeURIComponent(request.headers.get('X-File-Name') || ''); } catch (e) { /* cleaned in uploadFile */ }
    const file = await uploadFile(env, name, request.body, length);
    return json({ ok: true, file });
  } catch (e) {
    return errorResponse(e);
  }
}
