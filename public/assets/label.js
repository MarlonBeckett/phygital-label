// Shared label logic: used by the tag pages (rendered on the server) and by
// the live preview in the phygital label maker. Plain ES module, no dependencies.

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
export const RESERVED = ['new', 'api', 'assets', 'fonts', 'tags', 'robots', 'index', 'functions', 'admin', '404', 'mcp', 'oauth', 'files'];

export const LIMITS = {
  slug: 40, title: 40, label: 32, videoTitle: 80, text: 2000, url: 2000,
  pages: 20, blocks: 60, fileBytes: 100000,
  editableText: 1000, // notes anyone can edit
  stack: 50 // files in one file stack
};

// Cleans text a visitor typed into an editable note: no control characters,
// Windows line ends, or trailing space. (It's always shown as plain text.)
export function cleanVisitorText(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    // Control, invisible formatting (incl. direction overrides), private-use
    // and unassigned characters: none belong in a visible note. Kept: line
    // breaks, tabs, and the joiners that hold emoji and some scripts together.
    .replace(/[^\P{C}\n\t\u200C\u200D\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export const BLOCK_TYPES = ['link', 'text', 'video', 'menu', 'heading', 'file', 'files'];

// ---- Uploaded files ----
// Public files live at /files/<id>/<name>; a file block stores "<id>/<name>".
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_REF_RE = /^[a-z0-9]{16}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const isFileRef = (ref) => typeof ref === 'string' && FILE_REF_RE.test(ref);

// Types a browser would run as a web page or script on this site's address.
// They can't be uploaded.
export const RISKY_EXTENSIONS = ['html', 'htm', 'xhtml', 'shtml', 'xht', 'svg', 'svgz', 'xml', 'xsl', 'xslt', 'js', 'mjs', 'cjs', 'es', 'wasm', 'swf', 'php'];

export function fileExtension(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : '';
}

const KINDS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'],
  video: ['mp4', 'webm', 'mov', 'm4v'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'],
  pdf: ['pdf'],
  text: ['txt', 'csv', 'md', 'json', 'log']
};

// Files that can be uploaded (and so are public): ones browsers show safely
// (KINDS below) plus common download-only types. Anything else (XML-like
// feeds, unknown or no extension) is refused, so nothing on the site can
// render as a page.
const DOWNLOADS = [
  'zip', '7z', 'rar', 'gz', 'tgz', 'tar', 'bz2', 'xz',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'pages', 'numbers', 'key', 'epub',
  'stl', 'step', 'stp', 'obj', '3mf', 'gcode', 'dxf', 'dwg', 'bin', 'hex', 'uf2', 'img', 'iso',
  'apk', 'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm',
  'heic', 'heif', 'tif', 'tiff', 'dng', 'psd', 'ai', 'eps', 'ttf', 'otf', 'woff', 'woff2', 'mid', 'midi', 'srt', 'vtt'
];
export function canBePublic(name) {
  const ext = fileExtension(name);
  return !!ext && (DOWNLOADS.includes(ext) || Object.values(KINDS).some((list) => list.includes(ext)));
}

// 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'risky' | 'other'
export function fileKind(name) {
  const ext = fileExtension(name);
  if (RISKY_EXTENSIONS.includes(ext)) return 'risky';
  for (const [kind, list] of Object.entries(KINDS)) if (list.includes(ext)) return kind;
  return 'other';
}

// A safe file name for the repo and the address: letters, digits, dots,
// dashes and underscores, extension kept, at most 100 characters.
export function safeFileName(name) {
  const base = String(name || '').split(/[\\/]/).pop().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const ext = fileExtension(base);
  let stem = (ext ? base.slice(0, -(ext.length + 1)) : base)
    .replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').replace(/-{2,}/g, '-').replace(/^[._-]+/, '').replace(/[._-]+$/, '');
  stem = stem.slice(0, 100 - (ext ? ext.length + 1 : 0)) || 'file';
  return ext ? `${stem}.${ext}` : stem;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Text style for a whole tag: the label font everywhere, or a regular font
// for reading text (titles and strips always stay label tape). A tag without
// its own choice follows the site default from Settings.
export const FONTS = ['label', 'regular'];
const isFont = (f) => FONTS.includes(f);
export const fontOf = (tag, siteDefault = 'label') =>
  (tag && isFont(tag.font) ? tag.font : isFont(siteDefault) ? siteDefault : 'label');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isSlug(s) {
  return typeof s === 'string' && SLUG_RE.test(s);
}

// The first free address after a taken one: "camera" → "camera-2", then
// "camera-3"… A numbered copy continues the series ("camera-2" → "camera-3")
// only when the plain name exists too, so "route-66" becomes "route-66-2".
export function nextFreeSlug(slug, taken) {
  const stripped = slug.replace(/-\d{1,2}$/, '');
  const base = stripped && stripped !== slug && taken.has(stripped) ? stripped : slug;
  for (let n = 2; n < 1000; n++) {
    const end = `-${n}`;
    const candidate = base.slice(0, LIMITS.slug - end.length).replace(/-+$/, '') + end;
    if (candidate !== slug && !taken.has(candidate) && !RESERVED.includes(candidate)) return candidate;
  }
  return '';
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

// Long labels print as several tapes, one per line, like a real label maker.
// Lines are picked by character count (not screen width) so pages work
// without JavaScript and the editor preview matches the page. Up to this
// many characters fit a phone at a comfortable size.
const LINE_MAX = { title: 14, strip: 22, heading: 24 };

// Splits text into as few lines as greedy wrapping needs, then evens them
// out. A single word longer than `max` keeps its own line (it auto-shrinks).
export function splitLines(text, max) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const wrap = (width) => {
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  if (!words.length) return [''];
  const n = wrap(max).length;
  if (n === 1) return [words.join(' ')];
  let width = Math.max(...words.map((w) => w.length));
  while (wrap(width).length > n) width++;
  return wrap(width);
}

const longest = (lines) => Math.max(...lines.map((l) => l.length));

// Each extra line gets its own small tilt and shift, so it reads as a
// separate label stuck under the one above.
function lineTilt(key, i, base = 0) {
  const r = rng(`${key}/${i}`);
  return `transform:rotate(${(base + (r() - 0.5) * 2.4).toFixed(2)}deg) translateX(${((r() - 0.5) * 16).toFixed(1)}px)`;
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
const ARROW_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

// A tape strip that opens `href` (a strip with no href shows as "coming soon").
function linkStrip(label, href, color, key) {
  const { c, tilt, shift } = stripVars(color, key);
  const style = `background-color:${color};transform:rotate(${tilt}deg) translateX(${shift}px);${fitStyle(label.length + 1, 48)}`;
  const lines = splitLines(label, LINE_MAX.strip);
  if (lines.length > 1) {
    const fit = fitStyle(longest(lines) + 1, 48);
    const tapes = lines.map((ln, i) =>
      `<span class="lt-strip lt-tape" style="background-color:${color};${lineTilt(key, i)};${fit}">` +
      `${letters(ln, c, href && i === lines.length - 1 ? '<span class="lt-chev">›</span>' : '')}</span>`
    ).join('');
    if (!href) return `<span class="lt-stack lt-pending" role="img" aria-label="${esc(label)} (coming soon)">${tapes}</span>`;
    return `<a class="lt-stack" href="${esc(href)}" aria-label="${esc(label)}">${tapes}</a>`;
  }
  if (!href) {
    // Placeholder: no address yet, so it shows but cannot be tapped.
    return `<span class="lt-strip lt-tape lt-pending" role="img" aria-label="${esc(label)} (coming soon)" style="${style}">${letters(label, c)}</span>`;
  }
  return `<a class="lt-strip lt-tape" href="${esc(href)}" aria-label="${esc(label)}" style="${style}">${letters(label, c, '<span class="lt-chev">›</span>')}</a>`;
}

function blockHtml(b, i, ctx) {
  const pageColor = ctx.color;
  const color = normColor(b.color) || pageColor;
  const key = (b.label || b.text || '') + '#' + i;

  if (b.type === 'heading') {
    const { c, tilt } = stripVars(color, key);
    const lines = splitLines(b.label, LINE_MAX.heading);
    if (lines.length > 1) {
      return `<h2 class="lt-stack lt-heading-stack" aria-label="${esc(b.label)}">` + lines.map((ln, i) =>
        `<span class="lt-heading lt-tape" style="background-color:${color};${lineTilt(key, i)}">${letters(ln, c)}</span>`
      ).join('') + '</h2>';
    }
    return `<h2 class="lt-heading lt-tape" aria-label="${esc(b.label)}" style="background-color:${color};transform:rotate(${tilt}deg)">${letters(b.label, c)}</h2>`;
  }

  if (b.type === 'link') return linkStrip(b.label || 'Link', isHttpUrl(b.url) ? b.url : '', color, key);


  if (b.type === 'menu') {
    const { c, tilt, shift } = stripVars(color, key);
    const label = b.label || 'Menu';
    const target = ctx.pages.find((p) => p.slug === b.page);
    const href = target ? (target.slug ? `/${ctx.tagSlug}/${target.slug}` : `/${ctx.tagSlug}`) : '';
    const attrs = href ? `href="${esc(href)}" data-page="${esc(target.slug)}"` : '';
    const tag = href ? 'a' : 'span';
    const lines = splitLines(label, LINE_MAX.strip);
    if (lines.length > 1) {
      // The second strip peeks out behind the last line only.
      const fit = fitStyle(longest(lines), 80);
      const last = lines.length - 1;
      return `<${tag} class="lt-menu lt-stack" ${attrs} aria-label="${esc(label)} (opens a menu)">` + lines.map((ln, i) =>
        `<span class="lt-line" style="${lineTilt(key, i)}">` +
        (i === last ? `<span class="lt-menu-back" aria-hidden="true" style="background-color:${shade(color, 0.62)}"></span>` : '') +
        `<span class="lt-strip lt-tape" style="background-color:${color};${fit}">${letters(ln, c)}${i === last ? MENU_ICON(c.fg) : ''}</span></span>`
      ).join('') + `</${tag}>`;
    }
    return `<${tag} class="lt-menu" ${attrs} aria-label="${esc(label)} (opens a menu)" style="transform:rotate(${tilt}deg) translateX(${shift}px)">` +
      `<span class="lt-menu-back" aria-hidden="true" style="background-color:${shade(color, 0.62)}"></span>` +
      `<span class="lt-strip lt-tape" style="background-color:${color};${fitStyle(label.length, 80)}">${letters(label, c)}${MENU_ICON(c.fg)}</span>` +
      `</${tag}>`;
  }

  if (b.type === 'text') {
    const r = rng(key);
    const tilt = ((r() - 0.5) * 0.9).toFixed(2);
    const linkColor = luminance(pageColor) > 0.18 ? '#1A1A1A' : pageColor;
    if (b.editable) {
      // Anyone can edit this note, so it's always plain text: no links.
      const where = `data-edit-tag="${esc(ctx.tagSlug)}" data-edit-page="${esc(ctx.pageSlug)}" data-edit-block="${i}"`;
      const control = '<div class="lt-edit-row"><span class="lt-edit-badge">Anyone can edit</span>' +
        (ctx.visitorEdit ? '<button type="button" class="lt-edit-btn" data-edit-open>Edit</button>' : '') + '</div>';
      return `<div class="lt-note lt-editable" ${where} style="transform:rotate(${tilt}deg);--link:${linkColor}"><p>${esc(b.text)}</p>${control}</div>`;
    }
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

  if (b.type === 'files') {
    // A file stack: the files side by side, one at a time, to swipe through
    // (stack.js adds the ‹ › buttons, the "2 / 5" count and keeps Download on
    // the file in view). The owner can switch on Download and "Anyone can
    // upload" (Add a file) separately.
    const refs = (Array.isArray(b.files) ? b.files : []).filter((r) => isFileRef(r) && !ctx.missingFiles.has(r));
    const where = `data-stack-tag="${esc(ctx.tagSlug)}" data-stack-page="${esc(ctx.pageSlug)}" data-stack-block="${i}"${b.downloads ? ' data-downloads' : ''}`;
    const items = refs.map((ref, n) => {
      const name = ref.split('/')[1];
      const kind = fileKind(name);
      const href = ctx.fileUrl(ref);
      const ext = esc(fileExtension(name).toUpperCase() || 'FILE');
      const thumb = kind === 'image'
        ? `<img src="${esc(href)}" alt="" loading="${n ? 'lazy' : 'eager'}" decoding="async">`
        : `<span class="lt-file-type">${kind === 'video' || kind === 'audio' ? `<span class="lt-file-play">${PLAY_ICON}</span>` : ''}${ext}</span>`;
      return `<li><a class="lt-file-card" href="${esc(href)}" data-kind="${kind}" data-name="${esc(name)}">${thumb}<span class="lt-file-label">${esc(name)}</span></a></li>`;
    }).join('');
    const empty = refs.length ? '' : `<p class="lt-stack-empty">No files yet.</p>`;
    const nav = `<div class="lt-stack-nav"${refs.length > 1 ? '' : ' hidden'}>` +
      `<button type="button" class="lt-stack-prev" aria-label="Previous file" disabled>${ARROW_ICON}</button>` +
      `<span class="lt-stack-count" aria-live="polite">1 / ${refs.length}</span>` +
      `<button type="button" class="lt-stack-next" aria-label="Next file">${ARROW_ICON}</button></div>`;
    const first = refs[0] ? refs[0].split('/')[1] : '';
    const download = !b.downloads ? ''
      : `<a class="lt-edit-btn lt-download-btn" href="${first ? esc(ctx.fileUrl(refs[0])) : '#'}" download="${esc(first)}"${first ? '' : ' hidden'}>Download</a>`;
    const add = !b.uploads ? '' : ctx.visitorEdit
      ? '<label class="lt-edit-btn lt-upload-btn">Add a file<input type="file" class="lt-upload-input" data-stack-upload></label>'
      : '';
    const badge = b.uploads ? '<span class="lt-edit-badge">Anyone can upload</span>' : '';
    const actions = badge || download || add ? `<div class="lt-edit-row">${badge}${download}${add}</div>` : '';
    const caption = b.label ? `<p class="lt-caption">${esc(b.label)}</p>` : '';
    return `<section class="lt-files" ${where} aria-label="${esc(b.label || 'Files')}">${caption}` +
      `<ul class="lt-file-stack${refs.length > 1 ? ' lt-many' : ''}" tabindex="0" aria-label="${esc(b.label || 'Files')}: swipe for more">${items}</ul>${empty}${nav}${actions}</section>`;
  }

  if (b.type === 'file') {
    // An uploaded file: images and media play inline, anything else opens
    // from a strip. A deleted file shows as "coming soon".
    const ref = isFileRef(b.file) && !ctx.missingFiles.has(b.file) ? b.file : '';
    const href = ref ? ctx.fileUrl(ref) : '';
    const name = ref ? ref.split('/')[1] : '';
    const caption = b.label ? `<p class="lt-caption">${esc(b.label)}</p>` : '';
    const kind = fileKind(name);
    if (href && kind === 'image') {
      return `<figure class="lt-media lt-image"><a href="${esc(href)}" aria-label="${esc(b.label || name)} (open full size)"><img src="${esc(href)}" alt="${esc(b.label || '')}" loading="lazy" decoding="async"></a>${caption}</figure>`;
    }
    if (href && kind === 'video') {
      return `<figure class="lt-media lt-video-file"><video src="${esc(href)}" controls preload="metadata" playsinline></video>${caption}</figure>`;
    }
    if (href && kind === 'audio') {
      return `<figure class="lt-media lt-audio">${caption}<audio src="${esc(href)}" controls preload="none"></audio></figure>`;
    }
    return linkStrip(b.label || name || 'File', href, color, key);
  }

  return '';
}

const BACK_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

// The "‹ Main title" link at the top of a sub-page, back to the main page.
export function backLinkHtml(tagSlug, mainTitle) {
  return `<a class="lt-back" href="/${esc(tagSlug)}" data-page="">${BACK_ICON}${esc(mainTitle || 'Back')}</a>`;
}

// HTML for one page of a tag: the title tape plus its blocks.
// tag: { pages: [...] }, page: one of tag.pages,
// opts: { tagSlug, compact, siteFont, fileUrl, missingFiles, visitorEdit }
export function renderPageHtml(tag, page, opts = {}) {
  const color = normColor(page.color) || DEFAULT_COLOR;
  const ctx = {
    color, pages: tag.pages || [], tagSlug: opts.tagSlug || '', pageSlug: page.slug || '',
    visitorEdit: !!opts.visitorEdit, // the live page shows Edit buttons; the preview a badge
    // The editor previews files through the API (they're live there at once).
    fileUrl: opts.fileUrl || ((ref) => `/files/${ref}`),
    missingFiles: opts.missingFiles || new Set() // deleted: shown as "coming soon"
  };
  const title = page.title || '';
  let html = `<div class="lt-blocks${opts.compact ? ' lt-compact' : ''}${fontOf(tag, opts.siteFont) === 'regular' ? ' lt-regular' : ''}">`;
  const titleLines = splitLines(title, LINE_MAX.title);
  if (title && titleLines.length > 1) {
    const c = ink(color);
    const fit = fitStyle(longest(titleLines), 56);
    html += `<h1 class="lt-stack lt-title-stack" aria-label="${esc(title)}">` + titleLines.map((ln, i) =>
      `<span class="lt-title lt-tape" style="background-color:${color};${fit};${lineTilt(title, i, -1.3)}">${letters(ln, c)}</span>`
    ).join('') + '</h1>';
  } else if (title) {
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
        const editable = b.editable === true;
        const max = editable ? LIMITS.editableText : LIMITS.text;
        if (text.length > max) fail(`${where}: text is longer than ${max} characters${editable ? ' (the limit for notes anyone can edit)' : ''}.`);
        out.text = text;
        if (editable) out.editable = true;
        return out;
      }
      const max = type === 'video' || type === 'file' || type === 'files' ? LIMITS.videoTitle : LIMITS.label;
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
      if (type === 'file') {
        const file = str(b.file).trim();
        if (file && !isFileRef(file)) fail(`${where}: that file isn't one of your uploads.`);
        out.file = file;
      }
      if (type === 'files') {
        const list = Array.isArray(b.files) ? b.files.map(str) : [];
        if (list.some((f) => !isFileRef(f))) fail(`${where}: a file in the stack isn't one of your uploads.`);
        if (list.length > LIMITS.stack) fail(`${where}: a file stack can have at most ${LIMITS.stack} files.`);
        out.files = [...new Set(list.filter(isFileRef))].slice(0, LIMITS.stack);
        if (b.uploads === true) out.uploads = true;
        if (b.downloads === true) out.downloads = true;
      }
      if (type === 'link' || type === 'menu' || type === 'heading' || type === 'file') {
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

  const tag = { v: 1, ...(isFont(input.font) ? { font: input.font } : {}), pages };
  if (errors.length === 0 && new TextEncoder().encode(JSON.stringify(tag)).length > LIMITS.fileBytes) {
    fail('This tag is too large. Remove some text or blocks.');
  }
  return { ok: errors.length === 0, errors, tag };
}
