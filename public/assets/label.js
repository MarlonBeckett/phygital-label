// Shared label logic: used by the tag pages (rendered on the server) and by
// the live preview in the tag maker. Plain ES module, no dependencies.

export const PRESETS = [
  { name: 'Black', hex: '#161616' },
  { name: 'Red', hex: '#AD161C' },
  { name: 'Blue', hex: '#1B4A9E' },
  { name: 'Green', hex: '#17633A' },
  { name: 'Yellow', hex: '#E9B819' },
  { name: 'Orange', hex: '#D9601A' },
  { name: 'Purple', hex: '#5B2A86' }
];
export const DEFAULT_COLOR = '#161616';

// Addresses that belong to the site itself and can never be a tag.
export const RESERVED = ['new', 'api', 'assets', 'fonts', 'tags', 'robots', 'index', 'functions', 'admin', '404'];

export const LIMITS = {
  slug: 40, title: 40, label: 32, videoTitle: 80, text: 2000, url: 2000,
  pages: 20, blocks: 60, fileBytes: 100000
};

export const BLOCK_TYPES = ['link', 'text', 'video', 'menu', 'heading'];

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isSlug(s) {
  return typeof s === 'string' && SLUG_RE.test(s);
}

export function slugProblem(s, { isTag = false } = {}) {
  if (!s) return 'Add an address for this page.';
  if (!isSlug(s)) return 'Only lowercase letters, numbers and dashes (not at the start or end).';
  if (isTag && RESERVED.includes(s)) return 'That address is reserved. Try another.';
  return '';
}

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isHttpUrl(u) {
  if (typeof u !== 'string' || u.length > LIMITS.url || /\s/.test(u)) return false;
  try {
    const url = new URL(u);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname;
  } catch (e) {
    return false;
  }
}

// Returns the 11-character video id for YouTube links, or '' for anything else.
export function youtubeId(u) {
  if (!isHttpUrl(u)) return '';
  let url;
  try { url = new URL(u); } catch (e) { return ''; }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let id = '';
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] || '';
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v') || '';
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] || '';
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
}

export function normColor(hex) {
  if (typeof hex !== 'string') return '';
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '';
  let v = m[1];
  if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
  return '#' + v.toUpperCase();
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex) {
  const f = (c) => { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const c = rgb(hex);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

function shade(hex, k) {
  return '#' + rgb(hex).map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');
}

// Letters switch to dark ink when the tape is light.
export function ink(hex) {
  if (luminance(hex) > 0.18) {
    return { fg: '#1B1B1B', sh: '0 1px 0 rgba(255,255,255,0.55), 0 -1px 0 rgba(0,0,0,0.25)' };
  }
  return { fg: '#F3F1EA', sh: '0 1px 0 rgba(0,0,0,0.5), 0 -1px 0 rgba(255,255,255,0.3), 0 0 1px rgba(255,255,255,0.5)' };
}

// Small deterministic random generator seeded from text, so every visit
// shows the same wobble.
export function rng(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function () { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
}

// Raised letters with slightly uneven baseline, spacing and opacity.
export function embossHtml(text) {
  const r = rng(String(text || ''));
  return Array.from(String(text || '').toUpperCase()).map((ch) => {
    const y = ((r() - 0.5) * 1.8).toFixed(2);
    const space = ch === ' ';
    const gap = (space ? 0 : r() * 1.4).toFixed(2);
    const o = (0.84 + r() * 0.16).toFixed(2);
    if (space) return '<span class="lt-sp"> </span>';
    return `<span style="transform:translateY(${y}px);margin-right:${gap}px;opacity:${o}">${esc(ch)}</span>`;
  }).join('');
}

// Splits text into plain parts and [words](https://…) links, escaping both.
export function richTextHtml(text) {
  const s = String(text || '');
  const re = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out += esc(s.slice(last, m.index));
    if (isHttpUrl(m[2])) out += `<a href="${esc(m[2])}">${esc(m[1])}</a>`;
    else out += esc(m[0]);
    last = m.index + m[0].length;
  }
  if (last < s.length) out += esc(s.slice(last));
  return out;
}

// Font size shrinks with the label length so it fits the strip. The glyphs
// are about 0.64em wide; `extra` is padding plus any icon.
function fitStyle(len, extra) {
  const n = (Math.max(len, 1) * 0.64).toFixed(2);
  return `--n:${n};--x:${extra}px`;
}

function stripVars(color, key) {
  const c = ink(color);
  const r = rng(key);
  const tilt = ((r() - 0.5) * 2.6).toFixed(2);
  const shift = ((r() - 0.5) * 14).toFixed(1);
  return { c, tilt, shift, r };
}

function letters(label, c, extraHtml = '') {
  return `<span class="lt-letters" aria-hidden="true" style="color:${c.fg};text-shadow:${c.sh}">${embossHtml(label)}${extraHtml}</span>`;
}

const MENU_ICON = (fg) => `<svg class="lt-menu-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="${fg}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>`;

const PLAY_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z" fill="#161616"/></svg>';

function blockHtml(b, i, ctx) {
  const pageColor = ctx.color;
  const color = normColor(b.color) || pageColor;
  const key = (b.label || b.text || '') + '#' + i;

  if (b.type === 'heading') {
    const { c, tilt } = stripVars(color, key);
    return `<h2 class="lt-heading lt-tape" aria-label="${esc(b.label)}" style="background-color:${color};transform:rotate(${tilt}deg)">${letters(b.label, c)}</h2>`;
  }

  if (b.type === 'link') {
    const { c, tilt, shift } = stripVars(color, key);
    const label = b.label || 'Link';
    const style = `background-color:${color};transform:rotate(${tilt}deg) translateX(${shift}px);${fitStyle(label.length + 1, 48)}`;
    if (!isHttpUrl(b.url)) {
      // Placeholder: no address yet, so it shows but cannot be tapped.
      return `<span class="lt-strip lt-tape lt-pending" role="img" aria-label="${esc(label)} (coming soon)" style="${style}">${letters(label, c)}</span>`;
    }
    return `<a class="lt-strip lt-tape" href="${esc(b.url)}" aria-label="${esc(label)}" style="${style}">${letters(label, c, '<span class="lt-chev">›</span>')}</a>`;
  }

  if (b.type === 'menu') {
    const { c, tilt, shift } = stripVars(color, key);
    const label = b.label || 'Menu';
    const target = ctx.pages.find((p) => p.slug === b.page);
    const href = target ? (target.slug ? `/${ctx.tagSlug}/${target.slug}` : `/${ctx.tagSlug}`) : '';
    const attrs = href ? `href="${esc(href)}" data-page="${esc(target.slug)}"` : '';
    const tag = href ? 'a' : 'span';
    return `<${tag} class="lt-menu" ${attrs} aria-label="${esc(label)} (opens a menu)" style="transform:rotate(${tilt}deg) translateX(${shift}px)">` +
      `<span class="lt-menu-back" aria-hidden="true" style="background-color:${shade(color, 0.62)}"></span>` +
      `<span class="lt-strip lt-tape" style="background-color:${color};${fitStyle(label.length, 80)}">${letters(label, c)}${MENU_ICON(c.fg)}</span>` +
      `</${tag}>`;
  }

  if (b.type === 'text') {
    const r = rng(key);
    const tilt = ((r() - 0.5) * 0.9).toFixed(2);
    const linkColor = luminance(pageColor) > 0.18 ? '#1A1A1A' : pageColor;
    return `<div class="lt-note" style="transform:rotate(${tilt}deg);--link:${linkColor}"><p>${richTextHtml(b.text)}</p></div>`;
  }

  if (b.type === 'video') {
    const id = youtubeId(b.url);
    const title = b.label || 'Video';
    const caption = b.label ? `<p class="lt-caption">${esc(b.label)}</p>` : '';
    if (!id) {
      return `<div class="lt-video"><span class="lt-player lt-player-empty" role="img" aria-label="Video coming soon"><span class="lt-yt">Video coming soon</span></span>${caption}</div>`;
    }
    return `<div class="lt-video"><a class="lt-player" href="https://www.youtube.com/watch?v=${id}" data-yt="${id}" aria-label="Play video: ${esc(title)}">` +
      `<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` +
      `<span class="lt-play">${PLAY_ICON}</span></a>${caption}</div>`;
  }

  return '';
}

// HTML for one page of a tag: the title tape plus its blocks.
// tag: { pages: [...] }, page: one of tag.pages, opts: { tagSlug, compact }
export function renderPageHtml(tag, page, opts = {}) {
  const color = normColor(page.color) || DEFAULT_COLOR;
  const ctx = { color, pages: tag.pages || [], tagSlug: opts.tagSlug || '' };
  const title = page.title || '';
  let html = `<div class="lt-blocks${opts.compact ? ' lt-compact' : ''}">`;
  if (title) {
    const c = ink(color);
    html += `<h1 class="lt-title lt-tape" aria-label="${esc(title)}" style="background-color:${color};${fitStyle(title.length, 56)}">${letters(title, c)}</h1>`;
  }
  (page.blocks || []).forEach((b, i) => { html += blockHtml(b, i, ctx); });
  html += '</div>';
  return html;
}

// Checks and cleans a tag before it is saved. Used by the editor (to show
// problems) and again by the server (which never trusts the browser).
// Returns { ok, errors: [string], tag } where tag holds only known fields.
export function validateTag(input) {
  const errors = [];
  const fail = (msg) => { errors.push(msg); };
  const str = (v) => (typeof v === 'string' ? v : '');

  if (!input || typeof input !== 'object' || !Array.isArray(input.pages)) {
    return { ok: false, errors: ['The tag has no pages.'], tag: null };
  }
  if (input.pages.length < 1) fail('A tag needs at least one page.');
  if (input.pages.length > LIMITS.pages) fail(`A tag can have at most ${LIMITS.pages} pages.`);

  const seen = new Set();
  const pages = input.pages.slice(0, LIMITS.pages).map((p, pi) => {
    p = p && typeof p === 'object' ? p : {};
    const slug = str(p.slug);
    const name = str(p.title).trim() || (pi === 0 ? 'Main page' : `Page ${pi + 1}`);
    if (pi === 0) {
      if (slug !== '') fail('The first page is the main page and has no page address.');
    } else {
      const problem = slugProblem(slug);
      if (problem) fail(`"${name}": ${problem}`);
      else if (seen.has(slug)) fail(`"${name}": another page already uses the address "${slug}".`);
      seen.add(slug);
    }
    const title = str(p.title).trim();
    if (title.length > LIMITS.title) fail(`"${name}": the page title is longer than ${LIMITS.title} characters.`);
    const blocksIn = Array.isArray(p.blocks) ? p.blocks : [];
    if (blocksIn.length > LIMITS.blocks) fail(`"${name}": a page can have at most ${LIMITS.blocks} blocks.`);
    const blocks = blocksIn.slice(0, LIMITS.blocks).map((b, bi) => {
      b = b && typeof b === 'object' ? b : {};
      const where = `"${name}", block ${bi + 1}`;
      const type = str(b.type);
      if (!BLOCK_TYPES.includes(type)) { fail(`${where}: unknown block type.`); return null; }
      const out = { type };
      const label = str(b.label).trim();
      const url = str(b.url).trim();
      if (type === 'text') {
        const text = str(b.text);
        if (text.length > LIMITS.text) fail(`${where}: text is longer than ${LIMITS.text} characters.`);
        out.text = text;
        return out;
      }
      const max = type === 'video' ? LIMITS.videoTitle : LIMITS.label;
      if (label.length > max) fail(`${where}: the label is longer than ${max} characters.`);
      out.label = label;
      if (type === 'link') {
        if (url && !isHttpUrl(url)) fail(`${where}: links must start with https:// or http://`);
        out.url = url;
      }
      if (type === 'video') {
        if (url && !youtubeId(url)) fail(`${where}: only YouTube links can be used for videos.`);
        out.url = url;
      }
      if (type === 'menu') out.page = str(b.page);
      if (type === 'link' || type === 'menu' || type === 'heading') {
        const c = normColor(b.color);
        if (b.color && !c) fail(`${where}: that colour is not valid.`);
        if (c) out.color = c;
      }
      return out;
    }).filter(Boolean);
    const color = normColor(p.color);
    if (p.color && !color) fail(`"${name}": the tape colour is not valid.`);
    return { slug: pi === 0 ? '' : slug, title, color: color || DEFAULT_COLOR, blocks };
  });

  const slugs = new Set(pages.map((p) => p.slug));
  pages.forEach((p) => {
    p.blocks.forEach((b, bi) => {
      if (b.type === 'menu' && !slugs.has(b.page)) {
        fail(`"${p.title || 'Main page'}", block ${bi + 1}: the menu opens a page that does not exist.`);
      }
    });
  });

  const tag = { v: 1, pages };
  if (errors.length === 0 && new TextEncoder().encode(JSON.stringify(tag)).length > LIMITS.fileBytes) {
    fail('This tag is too large. Remove some text or blocks.');
  }
  return { ok: errors.length === 0, errors, tag };
}
