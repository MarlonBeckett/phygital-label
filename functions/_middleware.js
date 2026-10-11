// Runs before every server function: makes the site settings (default text
// style, sign-in epoch) available to them.
import { loadSettings, settingsReady } from '../lib/settings.js';

// Anything that signs or checks a login needs the real sign-in epoch.
const SIGN_IN = /^\/(api|mcp|oauth)(\/|$)/;

export async function onRequest(context) {
  await loadSettings(context.request, context.env);
  if (!settingsReady() && SIGN_IN.test(new URL(context.request.url).pathname)) {
    return new Response(JSON.stringify({ error: 'The site is updating. Try again in a moment.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' }
    });
  }
  return context.next();
}
