// /<tag>  →  the main page of a tag
import { servePage } from '../lib/page.js';

export function onRequest(context) {
  return servePage(context, String(context.params.tag), '');
}
