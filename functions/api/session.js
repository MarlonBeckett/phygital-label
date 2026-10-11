// GET /api/session  →  is this device unlocked?
import { json } from '../../lib/http.js';
import { requireSession } from '../../lib/auth.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  return json({ ok: true });
}
