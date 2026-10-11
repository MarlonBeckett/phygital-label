// POST /api/login  { password }  →  sets the 30-day login cookie
import { json } from '../../lib/http.js';
import {
  passwordProblem, safeEqual, makeSessionCookie, sameOrigin,
  startAttempt, clearFailures, failureDelay
} from '../../lib/auth.js';

export async function onRequestPost({ request, env }) {
  const problem = passwordProblem(env);
  if (problem) return json({ error: problem, setup: true }, 500);
  if (!sameOrigin(request)) return json({ error: 'Request blocked.' }, 403);

  const wait = startAttempt(request);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60000);
    return json({ error: `Too many wrong tries. Wait ${minutes} minute${minutes === 1 ? '' : 's'}, then try again.` }, 429);
  }

  let password = '';
  try {
    const body = await request.json();
    password = typeof body.password === 'string' ? body.password.slice(0, 256) : '';
  } catch (e) { /* treated as a wrong password */ }

  if (!(await safeEqual(password, env.ADMIN_PASSWORD))) {
    await failureDelay();
    return json({ error: 'Wrong password. Wait a few seconds, then try again.' }, 401);
  }

  clearFailures(request);
  return json({ ok: true }, 200, { 'Set-Cookie': await makeSessionCookie(env, request) });
}
