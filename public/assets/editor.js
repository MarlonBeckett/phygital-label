// Phygital label maker (/new): unlock, see and manage your labels on the main
// menu, edit pages and blocks with a live preview, save to GitHub through
// /api, then write the address to an NFC tag.

import {
  PRESETS, DEFAULT_COLOR, LIMITS, esc, embossHtml, normColor, isHttpUrl, youtubeId,
  slugProblem, renderPageHtml, validateTag, ink, nextFreeSlug, backLinkHtml,
  fileKind, formatBytes, MAX_FILE_BYTES, canBePublic, fileExtension
} from './label.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'tag-maker-draft-v1';
const SITE_FONT_KEY = 'tag-maker-site-font';

const ICONS = {
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  text: 'M5 6h14M5 11h14M5 16h9',
  video: 'M3 6h18v12H3zM10 9.5v5l4.5-2.5z',
  menu: 'M4 6h16M4 12h16M4 18h10',
  heading: 'M6 5v14M18 5v14M6 12h12',
  file: 'M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7'
};
const TYPE_NAMES = { link: 'Link', text: 'Text', video: 'Video', menu: 'Menu', heading: 'Heading', file: 'File' };
const LABEL_HINTS = { link: 'Label, e.g. Manual', menu: 'Menu name', heading: 'Heading text', video: 'Video title', file: 'Label or caption, e.g. Manual' };

const svg = (path, size = 18, width = 2.2) =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;

// ---------------------------------------------------------------- state ---

let seq = 1;
const newId = (prefix) => prefix + (seq++);

let state = blankState();

function blankState() {
  return {
    tagSlug: '',
    loadedSlug: '', // the tag as it was opened from GitHub…
    sha: '', // …and its version, so saves never overwrite newer edits
    dirty: false, // changed since it was opened or saved
    current: 'main',
    font: '', // '' follows the site default
    pages: [{ id: 'main', title: '', slug: '', color: DEFAULT_COLOR, blocks: [newBlock('link')] }]
  };
}

function newBlock(type, target = '') {
  return { id: newId('b'), type, label: '', url: '', text: '', color: '', target, file: '', editable: false };
}

function page() {
  return state.pages.find((p) => p.id === state.current) || state.pages[0];
}
const isMain = (p) => p.id === state.pages[0].id;

function slugify(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.slug).replace(/-+$/, '');
}

function uniquePageSlug(base) {
  const taken = new Set(state.pages.map((p) => p.slug));
  let s = base || 'page';
  let n = 2;
  while (taken.has(s) || !s) s = `${(base || 'page').slice(0, LIMITS.slug - 4)}-${n++}`;
  return s;
}

function makePage(title) {
  const t = String(title || 'New page').slice(0, LIMITS.title);
  return { id: newId('p'), title: t, slug: uniquePageSlug(slugify(t)), color: page().color, blocks: [] };
}

// Editor state → the saved file format.
function toData() {
  const byId = new Map(state.pages.map((p, i) => [p.id, i === 0 ? '' : p.slug]));
  return {
    v: 1,
    // A choice equal to the site default is saved as "follow the default".
    ...((state.font === 'label' || state.font === 'regular') && state.font !== siteFont ? { font: state.font } : {}),
    pages: state.pages.map((p, i) => ({
      slug: i === 0 ? '' : p.slug,
      title: p.title.trim(),
      color: normColor(p.color) || DEFAULT_COLOR,
      blocks: p.blocks.map((b) => {
        if (b.type === 'text') return { type: 'text', text: b.text, ...(b.editable ? { editable: true } : {}) };
        const out = { type: b.type, label: b.label.trim() };
        if (b.type === 'link' || b.type === 'video') out.url = b.url.trim();
        if (b.type === 'file') out.file = b.file || '';
        if (b.type === 'menu') out.page = byId.has(b.target) ? byId.get(b.target) : '#missing';
        if ((b.type === 'link' || b.type === 'menu' || b.type === 'heading' || b.type === 'file') && b.color) out.color = b.color;
        return out;
      })
    }))
  };
}

// Saved file format → editor state.
function fromData(slug, tag, sha) {
  const ids = tag.pages.map((p, i) => (i === 0 ? 'main' : newId('p')));
  const bySlug = new Map(tag.pages.map((p, i) => [p.slug, ids[i]]));
  return {
    tagSlug: slug,
    loadedSlug: slug,
    sha: sha || '',
    dirty: false,
    current: 'main',
    font: tag.font || '',
    pages: tag.pages.map((p, i) => ({
      id: ids[i],
      title: p.title || '',
      slug: i === 0 ? '' : p.slug,
      color: normColor(p.color) || DEFAULT_COLOR,
      blocks: (p.blocks || []).map((b) => ({
        id: newId('b'),
        type: b.type,
        label: b.label || '',
        url: b.url || '',
        text: b.text || '',
        file: b.file || '',
        editable: b.editable === true,
        color: normColor(b.color) || '',
        target: b.type === 'menu' ? (bySlug.get(b.page) || '') : ''
      }))
    }))
  };
}

// Keeps unsaved work if the page reloads or the phone drops the tab.
let draftTimer = 0;
function writeDraft() {
  clearTimeout(draftTimer);
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ seq, state })); } catch (e) { /* storage unavailable */ }
}
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(writeDraft, 300);
}
window.addEventListener('pagehide', writeDraft);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeDraft(); });
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !d.state || !Array.isArray(d.state.pages) || !d.state.pages.length) return false;
    state = d.state;
    // Drafts from before the main menu: treat new work as unsaved.
    if (typeof state.dirty !== 'boolean') state.dirty = !state.loadedSlug && hasWork();
    seq = Math.max(seq, Number(d.seq) || 1000);
    return true;
  } catch (e) {
    return false;
  }
}
// Marks the label as edited (so leaving and coming back keeps the draft).
function edited() {
  state.dirty = true;
  saveDraft();
}
function changed() {
  edited();
  renderLive();
}

// ------------------------------------------------------------------ api ---

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
  } catch (e) {
    return { status: 0, data: { error: 'No connection. Check your internet and try again.' } };
  }
  let data = {};
  try { data = await res.json(); } catch (e) { data = { error: `Something went wrong (${res.status}).` }; }
  return { status: res.status, data };
}

// -------------------------------------------------------------- screens ---

// Asks a question in the app's own dialog. (The browser's confirm() and
// alert() are silently blocked in some in-app browsers, which made buttons
// look dead.) Resolves with the tapped button's value, or null for Cancel.
// Button styles: 'dark' (default), 'danger', 'outline'.
let cancelOpenDialog = null;

function choose(message, buttons, { cancel = 'Cancel' } = {}) {
  // A new question cancels one that's still open, so answers can't cross.
  if (cancelOpenDialog) cancelOpenDialog();
  const d = $('ask-dialog');
  const box = $('ask-buttons');
  const list = cancel ? [...buttons, { label: cancel, value: null, style: 'plain' }] : buttons;
  const cls = { dark: 'tm-btn-dark', danger: 'tm-btn-danger-fill', outline: 'tm-btn-outline-lg', plain: 'tm-btn-plain' };
  $('ask-text').textContent = message;
  box.innerHTML = list.map((b, i) =>
    `<button type="button" class="tm-btn ${cls[b.style || 'dark']}" data-i="${i}">${esc(b.label)}</button>`
  ).join('');
  return new Promise((resolve) => {
    // Answer straight from the taps (the dialog's close event can arrive
    // late), and unhook every time so answers never pile up.
    const finish = (value) => {
      box.removeEventListener('click', onClick);
      d.removeEventListener('cancel', onEscape);
      cancelOpenDialog = null;
      if (d.open) d.close();
      resolve(value);
    };
    cancelOpenDialog = () => finish(null);
    const onClick = (e) => {
      const b = e.target.closest('[data-i]');
      if (b) finish(list[Number(b.getAttribute('data-i'))].value);
    };
    const onEscape = (e) => { e.preventDefault(); finish(null); };
    box.addEventListener('click', onClick);
    d.addEventListener('cancel', onEscape);
    d.showModal();
    box.querySelector('button').focus();
  });
}

// A yes/no question; resolves true for OK. Pass cancel: '' for a message.
function ask(message, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return choose(message, [{ label: ok, value: true, style: danger ? 'danger' : 'dark' }], { cancel }).then((v) => v === true);
}
const tell = (message) => ask(message, { cancel: '' });

function show(name) {
  for (const id of ['loading', 'screen-login', 'screen-home', 'screen-editor', 'screen-saved']) {
    $(id).hidden = id !== name;
  }
  document.body.classList.toggle('tm-board', name === 'screen-login' || name === 'screen-home');
  window.scrollTo(0, 0);
}

function setEmboss(el, text) {
  el.setAttribute('data-emboss', text);
  if (el.tagName === 'BUTTON' || el.tagName === 'A') el.setAttribute('aria-label', text);
  el.innerHTML = `<span class="lt-letters" aria-hidden="true">${embossHtml(text)}</span>`;
}

function fillEmboss() {
  document.querySelectorAll('[data-emboss]').forEach((el) => setEmboss(el, el.getAttribute('data-emboss')));
  // Letters inside an element that has other content (the upload label holds its file input).
  document.querySelectorAll('[data-emboss-inner]').forEach((el) => { el.innerHTML = embossHtml(el.getAttribute('data-emboss-inner')); });
}

function setupError(msg) {
  show('screen-login');
  $('login-error').textContent = msg;
  $('login-error').hidden = false;
  $('login-btn').disabled = true;
}

// ---------------------------------------------------------------- login ---

let afterLogin = null;

function showLogin(message) {
  show('screen-login');
  $('login-error').hidden = !message;
  $('login-error').textContent = message || '';
  setTimeout(() => $('pw').focus(), 50);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  const password = $('pw').value;
  if (!password) return;
  btn.disabled = true;
  setEmboss(btn, 'Checking…');
  $('login-error').hidden = true;
  const { status, data } = await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
  btn.disabled = false;
  setEmboss(btn, 'Unlock');
  if (status === 200) {
    $('pw').value = '';
    const next = afterLogin;
    afterLogin = null;
    loadSiteSettings();
    if (next) next(); else showHome();
    return;
  }
  if (data.setup) return setupError(data.error);
  $('login-error').textContent = data.error || 'Could not unlock. Try again.';
  $('login-error').hidden = false;
});

// ------------------------------------------------------------ main menu ---

const unsaved = () => state.dirty && hasWork();
let labels = [];

function showHome() {
  openSeq++; // likewise when going back to the menu
  show('screen-home');
  showTab('labels');
  $('mcp-url').textContent = `${location.origin}/mcp`;
  $('mcp-copied').hidden = true;
  $('mcp-copy').hidden = false;
  const draft = unsaved();
  $('home-draft').hidden = !draft;
  if (draft) {
    const main = state.pages[0];
    $('home-draft-name').textContent = main.title || (state.tagSlug ? `/${state.tagSlug}` : 'Untitled label');
  }
  loadLabels();
}

function homeMessage(text, retry) {
  $('label-count').textContent = '';
  $('label-list').innerHTML = `<div class="tm-empty"><p class="tm-hint tm-hint-lg">${esc(text)}</p>` +
    (retry ? '<button type="button" id="labels-retry" class="tm-btn-outline">Try again</button>' : '') + '</div>';
}

// The GitHub token is the one thing that wears out (it expires, often after
// a year). When it has, or soon will, say so plainly with the fix, since
// nobody remembers how this was set up.
let githubRepo = '';

// kind: 'bad' (GitHub rejects the key), 'warn' (it expires soon) or
// 'access' (the key works but can't reach the repo, or GITHUB_REPO is wrong).
function tokenHelpHtml(kind, expires = '') {
  const when = expires ? new Date(expires) : null;
  const days = when ? Math.ceil((when - Date.now()) / 86400000) : 0;
  const date = when ? when.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const repo = githubRepo ? `<span class="tm-code">${esc(githubRepo)}</span>` : 'your labels repo';
  const host = esc(location.host);
  const cloudflare = `In <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener">Cloudflare</a>, open <strong>Workers &amp; Pages</strong>, then this site's project (${host}), then <strong>Settings › Variables and Secrets</strong>`;
  const redeploy = `<li>Open <strong>Deployments</strong>, tap <strong>⋯</strong> on the latest one and choose <strong>Retry deployment</strong>. After a minute, tap Check again.</li>`;
  let title;
  let intro;
  let steps;
  if (kind === 'access') {
    title = 'The site can\'t reach your labels repo';
    intro = 'Your labels and stickers still work. GitHub accepts the site\'s key, but the key can\'t see the repo the site is set to use:';
    steps =
      `<li>The site is set to use ${repo}. If that's not your labels repo, ${cloudflare}, set <strong>GITHUB_REPO</strong> to your repo (like <span class="tm-code">your-name/my-tags</span>), then retry the deployment (step 3).</li>` +
      `<li>On GitHub, open <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">your fine-grained tokens</a> and the site's token. Under <strong>Repository access</strong> make sure ${repo} is included, and set <strong>Contents</strong> to <strong>Read and write</strong>. Save (don't regenerate). This takes effect straight away.</li>` +
      redeploy;
  } else {
    title = kind === 'bad' ? 'GitHub isn\'t accepting the site\'s key' : `Your GitHub key expires in ${days} day${days === 1 ? '' : 's'}`;
    intro = kind === 'bad'
      ? 'Your labels and stickers still work. To make or change labels, the site needs a working GitHub key. The key may have expired, been regenerated or deleted on GitHub, or been pasted wrong. It takes about 2 minutes:'
      : `Everything works until ${date}. Replace the key before then so saving keeps working. It takes about 2 minutes:`;
    steps =
      `<li>On GitHub, <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">make a new fine-grained token</a> (or copy the new value if you just regenerated it). Under <strong>Repository access</strong> pick only ${repo}, set <strong>Contents</strong> to <strong>Read and write</strong>, and choose the longest expiry. Copy the token.</li>` +
      `<li>${cloudflare}. Edit <strong>GITHUB_TOKEN</strong>, paste the token and save.</li>` +
      redeploy;
  }
  const look = kind === 'warn' ? 'warn' : 'bad';
  return `<div class="tm-notice tm-notice-${look}">` +
    `<h2 class="tm-notice-title">${esc(title)}</h2><p>${esc(intro)}</p><ol>${steps}</ol>` +
    `<button type="button" class="tm-btn-outline" data-recheck>Check again</button></div>`;
}

// Which fix-it card fits a GitHub error: 401 = the key is rejected,
// 403/404 = the key can't reach the repo (or GITHUB_REPO is wrong).
function githubFixKind(status) {
  if (status === 401) return 'bad';
  if (status === 403 || status === 404) return 'access';
  return '';
}

function showTokenNotice(kind, expires) {
  const box = $('token-notice');
  box.innerHTML = kind ? tokenHelpHtml(kind, expires) : '';
  box.hidden = !kind;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-recheck]')) { $('save-errors').hidden = true; showHome(); }
});

async function loadLabels() {
  homeMessage('Loading your labels…');
  const { status, data } = await api('/api/tags');
  if (status === 401 && data.login) return showLogin('Please unlock again.');
  if (data.repo) githubRepo = data.repo;
  if (status !== 200) {
    const kind = githubFixKind(data.github);
    if (kind) {
      showTokenNotice(kind);
      return homeMessage('Your labels can\'t be listed until GitHub is sorted out (see above). They still work on your stickers.');
    }
    showTokenNotice('');
    return homeMessage(data.error || 'Could not load your labels.', !data.setup);
  }
  const daysLeft = data.tokenExpires ? (new Date(data.tokenExpires) - Date.now()) / 86400000 : Infinity;
  showTokenNotice(daysLeft <= 0 ? 'bad' : daysLeft <= 14 ? 'warn' : '', data.tokenExpires);
  labels = data.tags || [];
  renderLabels();
}

function renderLabels() {
  const n = labels.length;
  $('label-count').textContent = n === 1 ? '1 label' : `${n} labels`;
  if (!n) return homeMessage('No labels yet. Tap New label to make your first one, or ask Claude.');
  $('label-list').innerHTML = labels.map((l) => {
    const c = ink(l.color);
    const title = l.title || l.slug;
    return `<div class="tm-item">` +
      `<button type="button" class="tm-item-main" data-edit="${esc(l.slug)}" aria-label="Edit ${esc(title)}">` +
      `<span class="tm-tape tm-item-tape" style="background-color:${esc(l.color)}"><span class="lt-letters" aria-hidden="true" style="color:${c.fg};text-shadow:${c.sh}">${embossHtml(title)}</span></span>` +
      `<span class="tm-item-addr">/${esc(l.slug)}${l.pages > 1 ? ` · ${l.pages} pages` : ''}${l.problems ? ' · needs fixing' : ''}</span>` +
      `</button>` +
      `<div class="tm-item-actions">` +
      `<button type="button" class="tm-btn-outline tm-btn-sm" data-edit="${esc(l.slug)}">Edit</button>` +
      `<a class="tm-btn-outline tm-btn-sm" href="/${esc(l.slug)}" target="_blank" rel="noopener">View</a>` +
      `<button type="button" class="tm-icon-btn tm-remove" data-delete="${esc(l.slug)}" aria-label="Delete /${esc(l.slug)}">${svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', 20, 2)}</button>` +
      `</div></div>`;
  }).join('');
}

$('label-list').addEventListener('click', async (e) => {
  if (e.target.closest('#labels-retry')) return loadLabels();
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const slug = edit.getAttribute('data-edit');
    if (state.loadedSlug === slug && state.dirty) return openEditor();
    if (unsaved() && !(await ask('Open this label? Your unsaved changes will be lost.', { ok: 'Open it' }))) return;
    edit.disabled = true;
    await openTag(slug, (msg) => tell(msg));
    edit.disabled = false;
    return;
  }
  const del = e.target.closest('[data-delete]');
  if (del) {
    const slug = del.getAttribute('data-delete');
    const item = labels.find((l) => l.slug === slug);
    if (!(await ask(`Delete /${slug}? Its page stops working, so any sticker pointing at it will show "Nothing here". This can't be undone here.`, { ok: 'Delete label', danger: true }))) return;
    del.disabled = true;
    const { status, data } = await api(`/api/tag/${encodeURIComponent(slug)}`, { method: 'DELETE', body: JSON.stringify({ sha: item ? item.sha : '' }) });
    del.disabled = false;
    if (status === 401 && data.login) return showLogin('Please unlock again.');
    if (status !== 200) return tell(data.error || 'Could not delete that label.');
    if (state.loadedSlug === slug) { state.loadedSlug = ''; state.sha = ''; saveDraft(); }
    labels = labels.filter((l) => l.slug !== slug);
    renderLabels();
  }
});

$('home-new').addEventListener('click', async () => {
  if (unsaved() && !(await ask('Start a new label? Your unsaved changes will be lost.', { ok: 'Start new' }))) return;
  state = blankState();
  saveDraft();
  openEditor();
});
$('home-draft').addEventListener('click', () => openEditor());

// Main menu tabs: Labels and Settings.
function showTab(name) {
  document.querySelectorAll('.tm-tab').forEach((t) => {
    const on = t.getAttribute('data-tab') === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  $('panel-labels').hidden = name !== 'labels';
  $('panel-files').hidden = name !== 'files';
  $('panel-settings').hidden = name !== 'settings';
  if (name === 'files') loadFiles();
  if (name === 'settings') {
    $('claude-card').open = false; // always starts collapsed
    $('site-font-status').textContent = '';
    loadHealth();
  }
}

// ---------------------------------------------------------------- files ---

// Uploaded files (public and private). Loaded with the Files tab and when the
// editor opens (the File block lists the public ones).
let files = [];
let filesLoaded = false;

const fileUrl = (f, download = false) =>
  `/api/file/${f.ref.split('/').map(encodeURIComponent).join('/')}?private=${f.private ? 1 : 0}${download ? '&download=1' : ''}`;
const publicUrl = (f) => `${location.origin}/files/${f.ref}`;

const FILE_ICONS = {
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5h.01',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
  audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  pdf: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  text: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 15h7M9 18h4',
  risky: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  other: 'M6 3h9l4 4v14H6zM14 3v5h5'
};

async function loadFiles(render = true) {
  if (render) fileListMessage('Loading your files…');
  const { status, data } = await api('/api/files');
  if (status === 401 && data.login) return showLogin('Please unlock again.');
  if (status !== 200) {
    if (render) fileListMessage(data.error || 'Could not load your files.');
    return;
  }
  files = data.files || [];
  filesLoaded = true;
  if (render) renderFiles();
  if (!$('screen-editor').hidden) { refreshFileBlocks(); renderLive(); }
}

// Redraws only the File block cards (their file lists), and not one you're
// in the middle of using, so typing elsewhere keeps its focus and keyboard.
function refreshFileBlocks() {
  const blocks = page().blocks;
  blocks.forEach((b, i) => {
    if (b.type !== 'file') return;
    const card = cardFor(b);
    if (!card || card.contains(document.activeElement)) return;
    card.outerHTML = blockCard(b, i, blocks.length);
  });
}

function fileListMessage(text) {
  $('file-count').textContent = '';
  $('file-list').innerHTML = `<div class="tm-empty"><p class="tm-hint tm-hint-lg">${esc(text)}</p></div>`;
}

function fileMeta(f) {
  const where = f.private ? 'Private: only you' : f.usedBy.length ? `Public, on ${f.usedBy.map((s) => `/${s}`).join(', ')}` : 'Public, not on a label yet';
  return `${formatBytes(f.size)} · ${where}`;
}

function renderFiles() {
  const n = files.length;
  $('file-count').textContent = n === 1 ? '1 file' : `${n} files`;
  if (!n) return fileListMessage('No files yet. Upload a manual, a photo, a receipt…');
  $('file-list').innerHTML = files.map((f) => {
    const thumb = f.kind === 'image'
      ? `<img class="tm-file-thumb" src="${esc(fileUrl(f))}" alt="" loading="lazy">`
      : `<span class="tm-file-thumb tm-file-icon">${svg(FILE_ICONS[f.kind] || FILE_ICONS.other, 22, 1.8)}</span>`;
    return `<div class="tm-item tm-file" data-ref="${esc(f.ref)}">` +
      `<button type="button" class="tm-file-main" data-file-act="view" aria-label="View ${esc(f.name)}">${thumb}` +
      `<span class="tm-file-text"><span class="tm-file-name">${esc(f.name)}</span><span class="tm-file-meta">${esc(fileMeta(f))}</span></span></button>` +
      `<div class="tm-item-actions">` +
      `<button type="button" class="tm-btn-outline tm-btn-sm" data-file-act="view">View</button>` +
      `<button type="button" class="tm-btn-outline tm-btn-sm" data-file-act="toggle">${f.private ? 'Make public' : 'Make private'}</button>` +
      (f.private ? '' : `<button type="button" class="tm-btn-outline tm-btn-sm" data-file-act="copy">Copy link</button>`) +
      `<button type="button" class="tm-icon-btn tm-remove" data-file-act="delete" aria-label="Delete ${esc(f.name)}">${svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', 20, 2)}</button>` +
      `</div></div>`;
  }).join('');
}

// Uploads one picked file. `visibility`: 'ask' (Files tab), or 'public' (File block).
async function uploadPicked(file, visibility, statusEl) {
  if (!file) return null;
  if (file.size > MAX_FILE_BYTES) {
    await tell(`${file.name} is ${formatBytes(file.size)}. Files can be up to ${formatBytes(MAX_FILE_BYTES)}.`);
    return null;
  }
  const kind = fileExtension(file.name) ? `.${fileExtension(file.name)} files` : 'Files without an extension';
  const publicOk = canBePublic(file.name);
  let isPrivate = false;
  if (visibility === 'ask') {
    const choice = await choose(
      `Who can see ${file.name}?\n\nPublic files can go on labels, for anyone who taps the sticker to open.\nPrivate files only show here, after unlocking.` +
      (publicOk ? '' : `\n\n${kind} can only be private: browsers could open them as web pages on your site.`),
      [...(publicOk ? [{ label: 'Public', value: 'public', style: 'outline' }] : []), { label: 'Private (only me)', value: 'private', style: 'dark' }]
    );
    if (!choice) return null;
    isPrivate = choice === 'private';
  } else if (!publicOk) {
    await tell(`${kind} can't go on a label (browsers could open them as web pages on your site). Upload it as a private file in the Files tab instead.`);
    return null;
  }
  statusEl.textContent = `Uploading ${file.name}…`;
  // Sent as base64 text: the server streams it to GitHub without touching it.
  const base64 = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  if (base64 === null) {
    statusEl.textContent = '';
    await tell(`Couldn't read ${file.name}. Try again.`);
    return null;
  }
  const res = await fetch('/api/files', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-File-Name': encodeURIComponent(file.name), 'X-File-Private': isPrivate ? '1' : '0', 'Content-Type': 'text/plain' },
    body: base64
  }).catch(() => null);
  let data = {};
  try { data = res ? await res.json() : { error: 'No connection. Check your internet and try again.' }; } catch (e) { data = { error: `Something went wrong (${res.status}).` }; }
  if (!res || res.status !== 200) {
    statusEl.textContent = '';
    if (res && res.status === 401 && data.login) { showLogin('Please unlock again, then upload the file again.'); return null; }
    await tell(data.error || 'Could not upload that file.');
    return null;
  }
  statusEl.textContent = isPrivate
    ? `Uploaded ${data.file.name} (private).`
    : `Uploaded ${data.file.name}. Its public link works in about a minute, once the site updates.`;
  files = files.filter((f) => f.ref !== data.file.ref).concat(data.file).sort((a, b) => a.name.localeCompare(b.name));
  return data.file;
}

$('files-upload').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (await uploadPicked(file, 'ask', $('upload-status'))) renderFiles();
});

$('file-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-file-act]');
  if (!btn) return;
  const ref = btn.closest('[data-ref]').getAttribute('data-ref');
  const f = files.find((x) => x.ref === ref);
  if (!f) return;
  const act = btn.getAttribute('data-file-act');
  if (act === 'view') return openViewer(f);
  if (act === 'copy') {
    try { await navigator.clipboard.writeText(publicUrl(f)); btn.textContent = 'Copied'; } catch (err) { await tell(publicUrl(f)); }
    return;
  }
  const onLabels = f.usedBy.length ? `\n\nIt's on ${f.usedBy.map((s) => `/${s}`).join(', ')}, which will show it as "coming soon".` : '';
  const oldCopies = f.private ? '' : '\n\nAnyone who already has its link may still reach copies on older versions of the site for a while.';
  if (act === 'toggle') {
    const toPrivate = !f.private;
    if (toPrivate && !(await ask(`Make ${f.name} private? From now on only you can open it here.${onLabels}${oldCopies}`, { ok: 'Make private' }))) return;
    btn.disabled = true;
    const { status, data } = await api(`/api/file/${ref}`, { method: 'PATCH', body: JSON.stringify({ wasPrivate: f.private, private: toPrivate }) });
    btn.disabled = false;
    if (status !== 200) return tell(data.error || 'Could not change that file.');
    f.private = toPrivate;
    renderFiles();
    return;
  }
  if (act === 'delete') {
    if (!(await ask(`Delete ${f.name}? This can't be undone here.${onLabels}${oldCopies}`, { ok: 'Delete file', danger: true }))) return;
    btn.disabled = true;
    const { status, data } = await api(`/api/file/${ref}?private=${f.private ? 1 : 0}`, { method: 'DELETE' });
    btn.disabled = false;
    if (status !== 200 && !data.missing) return tell(data.error || 'Could not delete that file.');
    files = files.filter((x) => x.ref !== ref);
    renderFiles();
  }
});

// ---- viewer ----

async function openViewer(f) {
  const body = $('viewer-body');
  const src = fileUrl(f);
  $('viewer-name').textContent = f.name;
  $('viewer-open').href = src;
  $('viewer-open').hidden = f.kind === 'risky' || f.kind === 'other';
  $('viewer-download').href = fileUrl(f, true);
  $('viewer-download').setAttribute('download', f.name);
  if (f.kind === 'image') body.innerHTML = `<img src="${esc(src)}" alt="${esc(f.name)}">`;
  else if (f.kind === 'pdf') body.innerHTML = `<iframe src="${esc(src)}" title="${esc(f.name)}"></iframe>`;
  else if (f.kind === 'video' || f.kind === 'audio') {
    // Loaded whole, then played from memory: iPhones won't stream media
    // from an address that doesn't support partial downloads.
    body.innerHTML = '<p class="tm-hint tm-hint-lg">Loading…</p>';
    fetch(src, { credentials: 'same-origin' }).then((r) => (r.ok ? r.blob() : Promise.reject())).then((blob) => {
      if (!$('viewer').open || $('viewer-name').textContent !== f.name) return;
      viewerObjectUrl = URL.createObjectURL(blob);
      const el = document.createElement(f.kind);
      el.src = viewerObjectUrl;
      el.controls = true;
      if (f.kind === 'video') el.playsInline = true;
      body.replaceChildren(el);
    }, () => { body.innerHTML = '<p class="tm-hint tm-hint-lg">Couldn\'t load it. Try Download instead.</p>'; });
  }
  else if (f.kind === 'text') {
    body.innerHTML = '<pre class="tm-viewer-text">Loading…</pre>';
    fetch(src, { credentials: 'same-origin' }).then((r) => r.text()).then((t) => { body.querySelector('pre').textContent = t; }, () => {});
  } else {
    body.innerHTML = `<p class="tm-hint tm-hint-lg">This kind of file can't be shown here. ${f.kind === 'risky' ? 'It could run code, so it only ever downloads.' : 'Download it to open it.'}</p>`;
  }
  $('viewer').showModal();
}

let viewerObjectUrl = '';

function closeViewer() {
  $('viewer').close();
  $('viewer-body').innerHTML = ''; // stops any playing video or audio
  if (viewerObjectUrl) { URL.revokeObjectURL(viewerObjectUrl); viewerObjectUrl = ''; }
}
$('viewer-close').addEventListener('click', closeViewer);
$('viewer').addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); });

// ------------------------------------------------------------- settings ---

// True while a text style change is being saved, so nothing else (a slow
// health check, a second tap) can flip the switch under it.
let savingSiteFont = false;
let fontSeq = 0; // bumped by each change, so older replies can be ignored

$('site-font-switch').addEventListener('change', async (e) => {
  const font = e.target.checked ? 'regular' : 'label';
  if (font === siteFont || savingSiteFont) return;
  fontSeq++;
  const before = siteFont;
  applySiteFont(font);
  savingSiteFont = true;
  e.target.disabled = true;
  $('site-font-status').textContent = 'Saving…';
  const { status, data } = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ font }) });
  savingSiteFont = false;
  e.target.disabled = false;
  if (status === 200) {
    $('site-font-status').textContent = 'Saved. Your labels switch over in about a minute, while the site updates.';
    return;
  }
  applySiteFont(before);
  if (status === 401 && data.login) return showLogin('Please unlock again.');
  $('site-font-status').textContent = data.error || 'Could not save.';
});

function healthRow(cls, text) {
  return `<li class="${cls}"><span>${esc(text)}</span></li>`;
}

function expiryRow(iso) {
  if (!iso) return healthRow('tm-ok', 'The GitHub token never expires.');
  if (iso === 'unknown') return healthRow('tm-warn', 'Couldn\'t read when the GitHub token expires. Check it on GitHub (Settings › Developer settings › Personal access tokens).');
  const when = new Date(iso);
  const days = Math.floor((when - Date.now()) / 86400000);
  const date = when.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  if (days < 0) return healthRow('tm-fail', `The GitHub token expired on ${date}. Saving won't work until you make a new one and update GITHUB_TOKEN in Cloudflare.`);
  if (days <= 14) return healthRow('tm-warn', `The GitHub token expires in ${days} day${days === 1 ? '' : 's'} (${date}). Make a new one soon and update GITHUB_TOKEN in Cloudflare.`);
  return healthRow('tm-ok', `The GitHub token expires on ${date} (in ${days} days).`);
}

async function loadHealth() {
  const list = $('health-list');
  list.innerHTML = healthRow('', 'Checking…');
  const seq = fontSeq;
  const { status, data } = await api('/api/settings?health=1');
  if (status === 401 && data.login) return showLogin('Please unlock again.');
  if (status !== 200 || !data.health) {
    list.innerHTML = healthRow('tm-fail', data.error || 'Could not check the site.');
    return;
  }
  const h = data.health;
  if (data.settings && !savingSiteFont && seq === fontSeq) applySiteFont(data.settings.font);
  list.innerHTML =
    healthRow('tm-ok', `Connected to GitHub: ${h.repo}${h.private ? ' (private)' : ''}.`) +
    (h.private ? '' : healthRow('tm-warn', 'The repo is public, so anyone can read your label files on GitHub. Make it private in the repo settings.')) +
    expiryRow(h.expires) +
    healthRow('tm-ok', `${h.labels} label${h.labels === 1 ? '' : 's'} saved.`);
}
$('health-refresh').addEventListener('click', () => loadHealth());

$('signout-all').addEventListener('click', async () => {
  const sure = await ask('Sign out everywhere? Every phone, including this one, will need the password again, and Claude will need to be reconnected. It takes effect in about a minute.', { ok: 'Sign out everywhere', danger: true });
  if (!sure) return;
  const btn = $('signout-all');
  btn.disabled = true;
  const { status, data } = await api('/api/reset-access', { method: 'POST', body: '{}' });
  btn.disabled = false;
  if (status === 401 && data.login) return showLogin('Please unlock again.');
  if (status !== 200) return tell(data.error || 'Could not sign out everywhere.');
  showLogin('Signed out everywhere. Wait about a minute for the site to update, then unlock again. Reconnect Claude from Settings.');
});
document.querySelector('.tm-tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) showTab(t.getAttribute('data-tab'));
});
document.querySelector('.tm-tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const order = ['labels', 'files', 'settings'];
  const now = order.findIndex((n) => $(`tab-${n}`).getAttribute('aria-selected') === 'true');
  const next = order[(now + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
  showTab(next);
  $(`tab-${next}`).focus();
});
$('back-home').addEventListener('click', () => showHome());
$('saved-home').addEventListener('click', () => showHome());
$('home-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' });
  showLogin('');
});

async function copyMcpUrl() {
  try {
    await navigator.clipboard.writeText(`${location.origin}/mcp`);
    $('mcp-copy').hidden = true;
    $('mcp-copied').hidden = false;
    return true;
  } catch (e) {
    return false;
  }
}
$('mcp-copy').addEventListener('click', async () => {
  if (!(await copyMcpUrl())) $('mcp-copy').textContent = 'Press and hold the address to copy';
});
// Copies the address on the way to Claude, so it's ready to paste.
$('claude-connect').addEventListener('click', () => { copyMcpUrl(); });

// --------------------------------------------------------------- editor ---

function openEditor() {
  openSeq++; // a slower Edit reply must not replace what's now open
  show('screen-editor');
  renderAll();
  refreshTaken();
  loadFiles(false); // the File block lists your public files
}

// Keeps the list of used addresses fresh, so the address field can say
// when a name is taken (labels may have been made elsewhere, e.g. by Claude).
async function refreshTaken() {
  const { status, data } = await api('/api/tags');
  if (status !== 200) return;
  labels = data.tags || [];
  if (!$('screen-editor').hidden) renderLive();
}

const takenSlugs = () => new Set(labels.map((l) => l.slug));

// True when the address belongs to another label than the one being edited.
function addressInUse(slug = state.tagSlug) {
  return !!slug && slug !== state.loadedSlug && takenSlugs().has(slug);
}

function renderAll() {
  const pg = page();
  $('pname').value = pg.title;
  $('addr').value = isMain(pg) ? state.tagSlug : pg.slug;
  $('addr-label').textContent = isMain(pg) ? 'Tag address' : 'Page address';
  $('addr-prefix').textContent = isMain(pg) ? `${location.host}/` : `…/${state.tagSlug || 'tag'}/`;
  $('delete-page').hidden = isMain(pg);
  renderSwatches();
  markFonts();
  renderBlocks();
  renderAddRow();
  $('save-errors').hidden = true;
  renderLive();
}

// Everything that can change while typing, without touching the inputs.
function renderLive() {
  const pg = page();
  const n = state.pages.length;
  $('page-count').textContent = n === 1 ? '1 page' : `${n} pages`;
  $('block-count').textContent = pg.blocks.length === 1 ? '1 block' : `${pg.blocks.length} blocks`;

  $('page-chips').innerHTML = state.pages.map((p) =>
    `<button type="button" class="tm-chip" data-page-id="${esc(p.id)}" aria-pressed="${p.id === pg.id}">` +
    `<span class="tm-chip-swatch" aria-hidden="true" style="background-color:${normColor(p.color) || DEFAULT_COLOR}"></span>` +
    `<span class="tm-chip-name">${esc(p.title || (isMain(p) ? 'Main page' : 'Untitled'))}</span></button>`
  ).join('') +
    `<button type="button" class="tm-chip tm-chip-add" id="add-page">${svg('M12 5v14M5 12h14', 14, 2.4)}Page</button>`;

  const path = isMain(pg) ? `/${state.tagSlug}` : `/${state.tagSlug}/${pg.slug}`;
  $('preview-path').textContent = path;

  const data = toData();
  const index = state.pages.indexOf(pg);
  const pageData = data.pages[index];
  const hasContent = pageData.title || pageData.blocks.length;
  $('preview').innerHTML = hasContent
    ? (index > 0 ? backLinkHtml(state.tagSlug || 'tag', data.pages[0].title) : '') +
      renderPageHtml(data, pageData, {
        tagSlug: state.tagSlug || 'tag', compact: true, siteFont,
        missingFiles: filesLoaded ? new Set(pageData.blocks.filter((b) => b.type === 'file' && b.file && !files.some((f) => !f.private && f.ref === b.file)).map((b) => b.file)) : undefined,
        // Through the API: a file uploaded a moment ago isn't on the site yet.
        fileUrl: (ref) => `/api/file/${ref}?private=0`
      })
    : '<p class="tm-preview-empty">Add a title or a block to see it here.</p>';

  const color = normColor(pg.color) || DEFAULT_COLOR;
  $('color-dot').style.backgroundColor = color;
  $('color-text').textContent = color;

  const problem = addressProblem();
  $('addr-box').classList.toggle('tm-bad', !!problem);
  $('addr-error').textContent = problem;
  $('addr-error').hidden = !problem;
  $('addr-hint').hidden = !!problem;

  const editing = state.loadedSlug && state.loadedSlug === state.tagSlug;
  $('editing-note').hidden = !state.loadedSlug;
  $('editing-note').textContent = editing
    ? `Editing /${state.loadedSlug}`
    : state.loadedSlug ? `Opened /${state.loadedSlug}. Saving will create a new tag at /${state.tagSlug || '…'}.` : '';
}

function addressProblem() {
  const pg = page();
  if (isMain(pg)) return slugProblem(state.tagSlug, { isTag: true }) || (addressInUse() ? 'Name already in use.' : '');
  const p = slugProblem(pg.slug);
  if (p) return p;
  if (state.pages.some((o) => o.id !== pg.id && o.slug === pg.slug)) return 'Another page already uses this address.';
  return '';
}

// Page chips, + Page, and menu strips in the preview.
document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-page-id]');
  if (chip) {
    state.current = chip.getAttribute('data-page-id');
    saveDraft();
    renderAll();
    return;
  }
  if (e.target.closest('#add-page')) {
    const np = makePage('New page');
    state.pages.push(np);
    state.current = np.id;
    edited();
    renderAll();
    $('pname').focus();
    $('pname').select();
    return;
  }
  const inPreview = e.target.closest('#preview a, #preview .lt-menu');
  if (inPreview) {
    e.preventDefault();
    const slug = inPreview.getAttribute('data-page');
    if (slug !== null) {
      const target = state.pages.find((p, i) => (i === 0 ? '' : p.slug) === slug);
      if (target) { state.current = target.id; saveDraft(); renderAll(); }
    }
  }
});

$('pname').addEventListener('input', (e) => {
  page().title = e.target.value;
  changed();
});

$('addr').addEventListener('input', (e) => {
  const el = e.target;
  const v = el.value.toLowerCase().replace(/\s+/g, '-');
  if (v !== el.value) el.value = v;
  const pg = page();
  if (isMain(pg)) {
    state.tagSlug = v;
    $('addr-prefix').textContent = `${location.host}/`;
  } else {
    pg.slug = v;
  }
  changed();
});

$('delete-page').addEventListener('click', async () => {
  const pg = page();
  if (isMain(pg)) return;
  if (!(await ask(`Delete the page "${pg.title || 'Untitled'}"? Menu strips that open it will be removed too.`, { ok: 'Delete page', danger: true }))) return;
  state.pages = state.pages
    .filter((p) => p.id !== pg.id)
    .map((p) => ({ ...p, blocks: p.blocks.filter((b) => !(b.type === 'menu' && b.target === pg.id)) }));
  state.current = state.pages[0].id;
  edited();
  renderAll();
});

// ---- tape colour ----

function renderSwatches() {
  const color = (normColor(page().color) || DEFAULT_COLOR);
  const preset = PRESETS.some((p) => p.hex === color);
  $('swatches').innerHTML = PRESETS.map((p) =>
    `<button type="button" class="tm-swatch${p.hex === color ? ' tm-on' : ''}" data-hex="${p.hex}" aria-pressed="${p.hex === color}">` +
    `<span class="tm-swatch-chip" style="background-color:${p.hex}"></span>${p.name}</button>`
  ).join('') +
    `<label class="tm-swatch tm-swatch-custom${preset ? '' : ' tm-on'}">` +
    `<span class="tm-swatch-chip" id="custom-chip"${preset ? '' : ` style="background-color:${color};background-image:none"`}>` +
    `<input type="color" id="custom-color" value="${color.toLowerCase()}" aria-label="Pick any color">` +
    `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>` +
    `</span>Custom</label>`;
}

function markSwatches() {
  const color = normColor(page().color) || DEFAULT_COLOR;
  let preset = false;
  $('swatches').querySelectorAll('[data-hex]').forEach((b) => {
    const on = b.getAttribute('data-hex') === color;
    preset = preset || on;
    b.classList.toggle('tm-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const custom = $('swatches').querySelector('.tm-swatch-custom');
  custom.classList.toggle('tm-on', !preset);
  const chip = $('custom-chip');
  chip.style.backgroundColor = preset ? '' : color;
  chip.style.backgroundImage = preset ? '' : 'none';
}

$('swatches').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hex]');
  if (!b) return;
  page().color = b.getAttribute('data-hex');
  $('custom-color').value = page().color.toLowerCase();
  markSwatches();
  changed();
  refreshBlockColors();
});
$('swatches').addEventListener('input', (e) => {
  if (e.target.id !== 'custom-color') return;
  page().color = normColor(e.target.value) || DEFAULT_COLOR;
  markSwatches();
  changed();
  refreshBlockColors();
});

// ---- text style ----

// The site's default text style (Settings). Remembered on this phone so the
// unlock screen already uses it.
let siteFont = 'label';
try { siteFont = localStorage.getItem(SITE_FONT_KEY) === 'regular' ? 'regular' : 'label'; } catch (e) { /* storage unavailable */ }

function applySiteFont(font) {
  siteFont = font === 'regular' ? 'regular' : 'label';
  try { localStorage.setItem(SITE_FONT_KEY, siteFont); } catch (e) { /* storage unavailable */ }
  document.body.classList.toggle('tm-regular', siteFont === 'regular');
  $('site-font-switch').checked = siteFont === 'regular';
  markFonts();
  if (!$('screen-editor').hidden) renderLive();
}
applySiteFont(siteFont);

async function loadSiteSettings() {
  const seq = fontSeq;
  const { status, data } = await api('/api/settings');
  if (status === 200 && data.settings && !savingSiteFont && seq === fontSeq) applySiteFont(data.settings.font);
}

// The label's own choice is one switch: off follows the site default, on
// uses the other font. (state.font '' = site default.)
function otherFont() {
  return siteFont === 'label' ? 'regular' : 'label';
}

function markFonts() {
  const own = state.font === 'label' || state.font === 'regular' ? state.font : '';
  const on = !!own && own !== siteFont;
  const other = otherFont();
  $('font-switch').checked = on;
  $('font-switch-title').textContent = `Use the ${other} font`;
  $('font-switch-title').className = `tm-switch-title tm-sample-${other}`;
  $('font-switch-hint').textContent = on
    ? `Notes and small text on this label use the ${other} font.`
    : `Off: follows the site default, the ${siteFont} font (change it in Settings).`;
}

$('font-switch').addEventListener('change', (e) => {
  state.font = e.target.checked ? otherFont() : '';
  markFonts();
  changed();
});

// ---- blocks ----

function blockCard(b, i, n) {
  const pg = page();
  const t = b.type;
  let h = `<div class="tm-block" data-block-id="${esc(b.id)}">`;
  h += '<div class="tm-block-top">';
  h += `<span class="tm-badge">${svg(ICONS[t], 14)}${TYPE_NAMES[t]}</span>`;
  h += `<button type="button" class="tm-icon-btn tm-first" data-act="up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${svg('M12 19V5M5 12l7-7 7 7')}</button>`;
  h += `<button type="button" class="tm-icon-btn" data-act="down" aria-label="Move down"${i === n - 1 ? ' disabled' : ''}>${svg('M12 5v14M5 12l7 7 7-7')}</button>`;
  h += `<button type="button" class="tm-icon-btn tm-remove" data-act="remove" aria-label="Remove block">${svg('M6 6l12 12M18 6L6 18')}</button>`;
  h += '</div>';

  if (t !== 'text') {
    const max = t === 'video' || t === 'file' ? LIMITS.videoTitle : LIMITS.label;
    h += `<input type="text" data-field="label" value="${esc(b.label)}" placeholder="${esc(LABEL_HINTS[t])}" aria-label="${esc(LABEL_HINTS[t])}" maxlength="${max}">`;
  }
  if (t === 'link') {
    h += `<input type="url" data-field="url" value="${esc(b.url)}" placeholder="https://" aria-label="Link address" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="url">`;
    h += '<p class="tm-error" data-msg="url" role="alert" hidden>Use a link that starts with https:// or http://</p>';
    h += '<p class="tm-hint" data-msg="empty" hidden>No link yet: the strip shows faded and can\'t be tapped until you add one.</p>';
  }
  if (t === 'text') {
    h += `<textarea data-field="text" rows="5" placeholder="Write anything…" aria-label="Text" maxlength="${b.editable ? LIMITS.editableText : LIMITS.text}">${esc(b.text)}</textarea>`;
    h += b.editable
      ? `<p class="tm-hint">Links don't work in notes anyone can edit (they show as plain text). Up to ${LIMITS.editableText} characters.</p>`
      : '<p class="tm-hint">Add a link inside text like this: <span class="tm-code">[words](https://…)</span></p>';
    h += `<label class="tm-switch-row tm-switch-inline"><span class="tm-switch-text"><span class="tm-switch-title">Anyone can edit</span>` +
      `<span class="tm-hint">People who tap the sticker can change this note, no login. Every change is kept in GitHub's history.</span></span>` +
      `<input type="checkbox" class="tm-switch" data-field="editable"${b.editable ? ' checked' : ''}></label>`;
  }
  if (t === 'video') {
    h += `<input type="url" data-field="url" value="${esc(b.url)}" placeholder="YouTube link" aria-label="YouTube link" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="url">`;
    h += '<p class="tm-error" data-msg="url" role="alert" hidden>Paste a YouTube link (youtube.com or youtu.be).</p>';
  }
  if (t === 'menu') {
    const others = state.pages.filter((p) => p.id !== pg.id);
    const sel = `sel-${b.id}`;
    h += `<div class="tm-menu-row"><label for="${esc(sel)}">Opens</label><select id="${esc(sel)}" data-field="target">`;
    if (!others.some((p) => p.id === b.target)) h += '<option value="" selected disabled>Choose a page</option>';
    h += others.map((p) => `<option value="${esc(p.id)}"${p.id === b.target ? ' selected' : ''}>${esc(p.title || (isMain(p) ? 'Main page' : 'Untitled'))}</option>`).join('');
    h += '<option value="__new">+ New page</option></select></div>';
  }
  if (t === 'file') {
    const pub = files.filter((f) => !f.private);
    const sel = `file-${b.id}`;
    const known = pub.some((f) => f.ref === b.file);
    h += `<div class="tm-menu-row"><label for="${esc(sel)}">File</label><select id="${esc(sel)}" data-field="file">`;
    if (!b.file) h += '<option value="" selected disabled>Choose a public file</option>';
    else if (!known) h += `<option value="${esc(b.file)}" selected>${esc(b.file.split('/')[1] || 'File')} (not available)</option>`;
    h += pub.map((f) => `<option value="${esc(f.ref)}"${f.ref === b.file ? ' selected' : ''}>${esc(f.name)} · ${esc(formatBytes(f.size))}</option>`).join('');
    h += '</select></div>';
    h += `<label class="tm-btn-outline tm-btn-sm tm-upload-inline">${svg('M12 16V4M6 10l6-6 6 6M4 20h16', 16, 2.2)}Upload a new file` +
      `<input type="file" class="tm-visually-hidden" data-upload-for="${esc(b.id)}"></label>`;
    h += '<p class="tm-hint" data-msg="upload" role="status"></p>';
    h += b.file && !known && files.length
      ? '<p class="tm-error">That file was deleted or made private, so the page shows it as "coming soon".</p>'
      : '<p class="tm-hint">Only public files can go on a label. Images, video and audio show on the page; other files open from a strip.</p>';
  }
  if (t === 'link' || t === 'menu' || t === 'heading' || t === 'file') {
    const cid = `col-${b.id}`;
    const value = b.color || normColor(pg.color) || DEFAULT_COLOR;
    h += `<div class="tm-color-row"><label for="${esc(cid)}">Color</label>`;
    h += `<span class="tm-color-box" style="background-color:${value}"><input id="${esc(cid)}" type="color" data-field="color" value="${value.toLowerCase()}"></span>`;
    h += `<span class="tm-color-text">${b.color ? b.color : 'Page color'}</span>`;
    h += `<button type="button" class="tm-reset" data-act="reset-color"${b.color ? '' : ' hidden'}>Use page color</button></div>`;
  }
  h += '</div>';
  return h;
}

function renderBlocks() {
  const pg = page();
  $('block-list').innerHTML = pg.blocks.map((b, i) => blockCard(b, i, pg.blocks.length)).join('');
  pg.blocks.forEach(updateBlockMessages);
}

function cardFor(b) {
  return $('block-list').querySelector(`[data-block-id="${CSS.escape(b.id)}"]`);
}

function updateBlockMessages(b) {
  const card = cardFor(b);
  if (!card) return;
  const url = b.url.trim();
  const urlInput = card.querySelector('[data-field="url"]');
  const bad = url && (b.type === 'video' ? !youtubeId(url) : !isHttpUrl(url));
  if (urlInput) urlInput.classList.toggle('tm-bad', !!bad);
  const msg = card.querySelector('[data-msg="url"]');
  if (msg) msg.hidden = !bad;
  const empty = card.querySelector('[data-msg="empty"]');
  if (empty) empty.hidden = !!url;
}

// When the page colour changes, blocks that follow it update their swatch.
function refreshBlockColors() {
  const color = normColor(page().color) || DEFAULT_COLOR;
  page().blocks.forEach((b) => {
    if (b.color) return;
    const card = cardFor(b);
    const box = card && card.querySelector('.tm-color-box');
    if (!box) return;
    box.style.backgroundColor = color;
    box.querySelector('input').value = color.toLowerCase();
  });
}

function blockFromEvent(e) {
  const card = e.target.closest('[data-block-id]');
  if (!card) return null;
  const id = card.getAttribute('data-block-id');
  return page().blocks.find((b) => b.id === id) || null;
}

$('block-list').addEventListener('input', (e) => {
  const b = blockFromEvent(e);
  const field = e.target.getAttribute('data-field');
  if (!b || !field || field === 'target') return;
  if (field === 'color') {
    b.color = normColor(e.target.value);
    const card = cardFor(b);
    card.querySelector('.tm-color-box').style.backgroundColor = b.color;
    card.querySelector('.tm-color-text').textContent = b.color;
    card.querySelector('[data-act="reset-color"]').hidden = false;
  } else if (field === 'editable') {
    b.editable = e.target.checked;
    if (b.editable && b.text.length > LIMITS.editableText) {
      b.editable = false;
      e.target.checked = false;
      tell(`Notes anyone can edit can be up to ${LIMITS.editableText} characters. Shorten this one first (it's ${b.text.length}).`);
      return;
    }
    edited();
    renderBlocks();
    renderLive();
    return;
  } else {
    b[field] = e.target.value;
    updateBlockMessages(b);
  }
  changed();
});

$('block-list').addEventListener('change', async (e) => {
  const b = blockFromEvent(e);
  if (b && e.target.getAttribute('data-field') === 'file') {
    b.file = e.target.value;
    edited();
    renderBlocks();
    renderLive();
    return;
  }
  if (b && e.target.hasAttribute('data-upload-for')) {
    const picked = e.target.files && e.target.files[0];
    e.target.value = '';
    const status = cardFor(b).querySelector('[data-msg="upload"]');
    const up = await uploadPicked(picked, 'public', status);
    if (!up) return;
    b.file = up.ref;
    if (!b.label) b.label = up.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, LIMITS.videoTitle);
    edited();
    renderBlocks();
    renderLive();
    const card = cardFor(b);
    if (card) card.querySelector('[data-msg="upload"]').textContent = status.textContent;
    return;
  }
  if (!b || e.target.getAttribute('data-field') !== 'target') return;
  if (e.target.value === '__new') {
    const np = makePage(b.label || 'New page');
    state.pages.push(np);
    b.target = np.id;
  } else {
    b.target = e.target.value;
  }
  edited();
  renderBlocks();
  renderLive();
});

$('block-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const b = blockFromEvent(e);
  if (!b) return;
  const blocks = page().blocks;
  const i = blocks.indexOf(b);
  const act = btn.getAttribute('data-act');
  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    renderBlocks();
    const moved = cardFor(b);
    if (moved) {
      const again = moved.querySelector(`[data-act="${act}"]`);
      (again && !again.disabled ? again : moved.querySelector('[data-act="remove"]')).focus();
    }
  } else if (act === 'remove') {
    const hasContent = b.label || b.url || b.text;
    if (hasContent && !(await ask('Remove this block?', { ok: 'Remove', danger: true }))) return;
    const at = blocks.indexOf(b);
    if (at > -1) blocks.splice(at, 1);
    renderBlocks();
  } else if (act === 'reset-color') {
    b.color = '';
    renderBlocks();
  }
  edited();
  renderLive();
});

function renderAddRow() {
  $('add-row').innerHTML = ['link', 'text', 'file', 'video', 'menu', 'heading'].map((t) =>
    `<button type="button" class="tm-add" data-add="${t}">${svg(ICONS[t], 20, 2)}${TYPE_NAMES[t]}</button>`
  ).join('');
}

$('add-row').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  const t = btn.getAttribute('data-add');
  const pg = page();
  if (pg.blocks.length >= LIMITS.blocks) return tell(`A page can have at most ${LIMITS.blocks} blocks.`);
  const others = state.pages.filter((p) => p.id !== pg.id);
  const b = newBlock(t, t === 'menu' && others[0] ? others[0].id : '');
  pg.blocks.push(b);
  edited();
  renderBlocks();
  renderLive();
  const card = cardFor(b);
  const first = card && card.querySelector('input[type="text"], textarea');
  if (first) first.focus();
  if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

// ------------------------------------------------------------ open tag ---

function hasWork() {
  return state.pages.length > 1 || state.tagSlug || state.pages[0].title ||
    state.pages[0].blocks.some((b) => b.label || b.url || b.text);
}

let openSeq = 0;

async function openTag(slug, onError) {
  const seq = ++openSeq;
  const { status, data } = await api(`/api/tag/${encodeURIComponent(slug)}`);
  if (seq !== openSeq) return false; // a later Edit tap took over
  if (status === 200) {
    state = fromData(data.slug, data.tag, data.sha);
    saveDraft();
    openEditor();
    if (data.warnings && data.warnings.length) showSaveErrors(['This tag has problems to fix before it can be saved:', ...data.warnings]);
    return true;
  }
  if (status === 401 && data.login) {
    afterLogin = () => openTag(slug, (msg) => { showHome(); tell(msg); });
    showLogin('Please unlock again.');
    return false;
  }
  onError(data.error || 'Could not open that tag.');
  return false;
}

// ----------------------------------------------------------------- save ---

function showSaveErrors(lines) {
  const box = $('save-errors');
  const [first, ...rest] = lines;
  box.innerHTML = `<strong>${esc(first)}</strong>` + (rest.length ? `<ul>${rest.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '');
  box.hidden = false;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

let savedUrl = '';

const putTag = (address, body) => api(`/api/tag/${encodeURIComponent(address)}`, { method: 'PUT', body: JSON.stringify(body) });

// Saves under the next free name after `base` ("camera-2"…), trying the next
// one if that name was taken in the meantime.
async function saveAsFree(base, tag) {
  await refreshTaken();
  const taken = new Set([...takenSlugs(), base]);
  let res = null;
  let saveAt = base;
  for (let i = 0; i < 5; i++) {
    saveAt = nextFreeSlug(base, taken);
    if (!saveAt) break;
    res = await putTag(saveAt, { tag });
    if (!(res.status === 409 && res.data.exists)) break;
    taken.add(saveAt);
  }
  return { res: res || { status: 409, data: { error: 'Could not find a free address.' } }, saveAt };
}

// The whole save conversation for one label: the first try, then the
// choices when the name is taken or the label changed elsewhere.
async function saveFlow(s, slug, tag) {
  const sha = s.loadedSlug === slug ? s.sha : '';
  let res = await putTag(slug, { tag, sha });
  if (res.status !== 409) return { res, saveAt: slug };

  await refreshTaken();
  const alt = nextFreeSlug(slug, new Set([...takenSlugs(), slug]));
  if (res.data.exists) {
    // The name is taken: save under the next free name, or take the name
    // and move the label that was there to that next free name.
    const choice = await choose(
      `/${slug} is already in use by another label.\n\nSave as /${alt} keeps that label as it is.\nReplace puts this one at /${slug} and moves the old one to /${alt}.`,
      [
        { label: `Save as /${alt}`, value: 'new', style: 'outline' },
        { label: `Replace /${slug}`, value: 'replace', style: 'danger' }
      ]
    );
    if (choice === 'new') return saveAsFree(slug, tag);
    if (choice === 'replace') return { res: await putTag(slug, { tag, replace: true }), saveAt: slug };
    return { cancelled: 'Not saved. Pick a different tag address, or choose Save as or Replace.' };
  }

  // Changed somewhere else since it was opened (another phone, or Claude).
  const choice = await choose(
    `/${slug} was changed somewhere else since you opened it: on another phone, by Claude, or by a visitor editing a note.\n\nOverwrite replaces that version with yours (including any visitor's note changes).\nSave as copy keeps both, saving yours at /${alt}.`,
    [
      { label: 'Save as copy', value: 'copy', style: 'outline' },
      { label: 'Overwrite', value: 'overwrite', style: 'danger' }
    ]
  );
  if (choice === 'copy') return saveAsFree(slug, tag);
  if (choice === 'overwrite') return { res: await putTag(slug, { tag, overwrite: true }), saveAt: slug };
  return { cancelled: 'Not saved. Your changes are kept here.' };
}

let saving = false;

function setSaving(on) {
  saving = on;
  $('save-btn').textContent = on ? 'Saving…' : 'Save tag';
  // Freeze the editor while saving: edits made now wouldn't be in this save,
  // and leaving could mix it up with the next label opened. (The save's own
  // questions use the dialog, which sits outside the editor.)
  $('screen-editor').inert = on;
  $('save-btn').disabled = on;
  $('back-home').disabled = on;
}

$('save-btn').addEventListener('click', async () => {
  if (saving) return;
  $('save-errors').hidden = true;
  const slug = state.tagSlug.trim();
  const problems = [];
  const slugIssue = slugProblem(slug, { isTag: true });
  if (slugIssue) problems.push(`Tag address: ${slugIssue}`);
  const data = toData();
  const { ok, errors, tag } = validateTag(data);
  if (!ok) problems.push(...errors);
  if (problems.length) return showSaveErrors(['Fix these first:', ...problems]);

  // Copy right away, while the tap still counts as a user action (iPhones
  // refuse to copy after waiting for the network).
  const url = `${location.origin}/${slug}`;
  let copied = Promise.resolve(false);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      copied = navigator.clipboard.writeText(url).then(() => true, () => false);
    }
  } catch (e) { /* clipboard unavailable */ }

  // `s` is the label this save belongs to, even if `state` moves on, and
  // `sent` is what was saved, to tell whether anything changed since.
  const s = state;
  const snapshot = () => JSON.stringify([s.pages, s.font]);
  const sent = snapshot();
  setSaving(true);
  let outcome;
  try {
    outcome = await saveFlow(s, slug, tag);
  } finally {
    setSaving(false);
  }
  if (outcome.cancelled) return showSaveErrors([outcome.cancelled]);
  const { res, saveAt } = outcome;

  if (res.status === 200) {
    s.tagSlug = saveAt;
    s.loadedSlug = saveAt;
    s.sha = res.data.sha || '';
    s.dirty = snapshot() !== sent;
    const movedTo = res.data.movedTo || '';
    labels = labels.filter((l) => l.slug !== saveAt).concat({ slug: saveAt }, movedTo ? [{ slug: movedTo }] : []);
    if (state !== s) return; // the editor moved on to another label meanwhile
    writeDraft();
    const finalUrl = `${location.origin}/${saveAt}`;
    showSaved(finalUrl, saveAt === slug && (await copied), movedTo ? `The label that was at /${slug} moved to /${movedTo}.` : '');
    return;
  }
  if (state !== s) return;
  if (res.status === 401 && res.data.login) {
    afterLogin = () => openEditor();
    showLogin('Please unlock again. Your changes are kept: tap Save tag once you\'re back.');
    return;
  }
  if (res.data.setup) return showSaveErrors(['The site is not set up yet:', res.data.error]);
  if (githubFixKind(res.data.github)) {
    const box = $('save-errors');
    box.innerHTML = tokenHelpHtml(githubFixKind(res.data.github));
    box.hidden = false;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  showSaveErrors([res.data.error || 'Could not save.', ...((res.data.errors || []).slice(1))]);
});

// ---------------------------------------------------------------- saved ---

function showSaved(url, copied, note = '') {
  savedUrl = url;
  $('saved-url').textContent = url;
  $('saved-moved').textContent = note;
  $('saved-moved').hidden = !note;
  $('copied-pill').hidden = !copied;
  $('copy-btn').hidden = copied;
  const canNfc = 'NDEFReader' in window;
  $('nfc-android').hidden = !canNfc;
  $('nfc-tools').hidden = canNfc;
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('hold-step').textContent = iphone
    ? 'Hold the tag near the top of your iPhone until it confirms.'
    : 'Hold the tag against the back of your phone until it confirms.';
  $('nfc-status').textContent = 'Tap the button, then hold the tag flat against the back of your phone until it buzzes.';
  show('screen-saved');
}

$('copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(savedUrl);
    $('copy-btn').hidden = true;
    $('copied-pill').hidden = false;
  } catch (e) {
    $('copy-btn').textContent = 'Press and hold the address to copy';
  }
});

$('nfc-btn').addEventListener('click', async () => {
  const status = $('nfc-status');
  const btn = $('nfc-btn');
  btn.disabled = true;
  status.textContent = 'Ready. Hold the tag flat against the back of your phone…';
  try {
    const ndef = new window.NDEFReader();
    await ndef.write({ records: [{ recordType: 'url', data: savedUrl }] });
    status.textContent = `Done! The tag now opens ${savedUrl}`;
  } catch (e) {
    if (e && e.name === 'NotAllowedError') {
      status.textContent = 'NFC was blocked. Allow NFC for this site in Chrome (tap the icon left of the address bar), then try again.';
    } else if (e && e.name === 'NotSupportedError') {
      status.textContent = 'This phone can\'t write tags from the browser. Use the NFC Tools app instead.';
    } else {
      status.textContent = 'Could not write the tag. Make sure NFC is on, keep the tag still against the phone, and try again. If the tag is locked it can\'t be rewritten.';
    }
  }
  btn.disabled = false;
});

$('edit-again').addEventListener('click', () => openEditor());
$('make-another').addEventListener('click', () => {
  state = blankState();
  saveDraft();
  openEditor();
});

// ---------------------------------------------------------------- start ---

async function start() {
  fillEmboss();
  loadDraft();
  const wanted = new URLSearchParams(location.search).get('tag');
  const { status, data } = await api('/api/session');
  if (status === 200) {
    loadSiteSettings();
    if (wanted && !slugProblem(wanted, { isTag: true }) && wanted !== state.loadedSlug) {
      if (unsaved()) {
        showHome();
        if (!(await ask(`Open /${wanted}? Your unsaved changes to the label you were editing will be lost.`, { ok: 'Open it' }))) return;
      }
      openEditor();
      await openTag(wanted, (msg) => showSaveErrors([msg]));
    } else if (wanted) {
      openEditor();
    } else {
      showHome();
    }
    return;
  }
  if (data.setup) return setupError(data.error);
  if (wanted) afterLogin = () => openTag(wanted, (msg) => { showHome(); tell(msg); });
  showLogin('');
}

start();
