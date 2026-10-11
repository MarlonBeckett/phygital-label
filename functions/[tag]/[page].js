// /<tag>/<page>  →  a sub-page of a tag
import { servePage } from '../../lib/page.js';

export function onRequest(context) {
  return servePage(context, String(context.params.tag), String(context.params.page));
}
