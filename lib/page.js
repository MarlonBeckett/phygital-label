// Builds the public tag pages (/<tag> and /<tag>/<page>) on the server.

import { esc, isSlug, RESERVED, renderPageHtml, validateTag, embossHtml, ink, fontOf, backLinkHtml, DEFAULT_COLOR } from '../public/assets/label.js';
import { html } from './http.js';
import { currentSettings } from './settings.js';
import { readAsset } from './assets.js';


function shell(title, body, extraClass = '', bodyClass = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="format-detection" content="telephone=no, email=no, address=no">
<meta name="theme-color" content="#E4E2DC">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/ImpactLabelReversed.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/assets/label.css">
<script src="/assets/stack.js" defer></script>
<script src="/assets/page.js" defer></script>
</head>
<body class="lt-page${bodyClass}">
<main class="lt-main${extraClass}">
${body}
</main>
</body>
</html>`;
}

export function notFound() {
  const c = ink(DEFAULT_COLOR);
  const body = `<div class="lt-blocks"><h1 class="lt-title lt-tape" aria-label="Nothing here" style="background-color:${DEFAULT_COLOR};--n:7.68;--x:56px"><span class="lt-letters" aria-hidden="true" style="color:${c.fg};text-shadow:${c.sh}">${embossHtml('Nothing here')}</span></h1></div>`;
  return html(shell('Not found', body), 404);
}

async function loadTag(context, slug) {
  const res = await readAsset(context.env, context.request, `/tags/${slug}.json`);
  if (!res.ok) return null;
  try {
    const { ok, tag } = validateTag(await res.json());
    return ok ? tag : null;
  } catch (e) {
    return null;
  }
}

export async function servePage(context, tagSlug, pageSlug) {
  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  // The raw data files stay private: only the rendered pages are public.
  if (tagSlug === 'tags') return notFound();
  // Anything that is not a tag address (site files like /new or /robots.txt)
  // goes to the static files instead.
  if (!isSlug(tagSlug) || RESERVED.includes(tagSlug)) return context.next();
  if (pageSlug !== '' && !isSlug(pageSlug)) return notFound();

  const tag = await loadTag(context, tagSlug);
  if (!tag) return notFound();
  const page = tag.pages.find((p) => p.slug === pageSlug);
  if (!page) return notFound();

  const main = tag.pages[0];
  const path = pageSlug ? `/${tagSlug}/${pageSlug}` : `/${tagSlug}`;
  let body = '';
  if (pageSlug) {
    body += `${backLinkHtml(tagSlug, main.title)}\n`;
  }
  const siteFont = currentSettings().font;
  // A file that was deleted or made private shows as "coming soon", not broken.
  const refs = [...new Set((page.blocks || []).flatMap((b) => (b.type === 'file' && b.file ? [b.file] : b.type === 'files' ? b.files || [] : [])))]
    .slice(0, 40); // a cap keeps big stacks within Cloudflare's per-request limits
  const missingFiles = new Set();
  await Promise.all(refs.map(async (ref) => {
    try {
      const res = await readAsset(context.env, context.request, `/files/${ref}`, { method: 'HEAD' });
      if (res.status === 404) missingFiles.add(ref);
    } catch (e) { /* can't tell: show it as normal rather than fail the page */ }
  }));
  body += renderPageHtml(tag, page, { tagSlug, siteFont, missingFiles, visitorEdit: true });
  body += `\n<p class="lt-path">${esc(path)}</p>`;
  const title = page.title || main.title || tagSlug;
  return html(shell(title, body, pageSlug ? ' lt-sub' : '', fontOf(tag, siteFont) === 'regular' ? ' lt-regular' : ''));
}
