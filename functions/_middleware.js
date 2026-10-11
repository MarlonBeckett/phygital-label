// Runs before every server function: makes the site settings (default text
// style, sign-in epoch) available to them.
import { loadSettings } from '../lib/settings.js';

export async function onRequest(context) {
  await loadSettings(context.request, context.env);
  return context.next();
}
