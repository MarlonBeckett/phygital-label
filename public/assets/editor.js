// Tag maker (/new): unlock, edit pages and blocks with a live preview, save
// to GitHub through /api, then write the address to an NFC tag.

import {
  PRESETS, DEFAULT_COLOR, LIMITS, esc, embossHtml, normColor, isHttpUrl, youtubeId,
  slugProblem, renderPageHtml, validateTag
} from './label.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'tag-maker-draft-v1';

const ICONS = {
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  text: 'M5 6h14M5 11h14M5 16h9',
  video: 'M3 6h18v12H3zM10 9.5v5l4.5-2.5z',
  menu: 'M4 6h16M4 12h16M4 18h10',
  heading: 'M6 5v14M18 5v14M6 12h12'
};
const TYPE_NAMES = { link: 'Link', text: 'Text', video: 'Video', menu: 'Menu', heading: 'Heading' };
const LABEL_HINTS = { link: 'Label, e.g. Manual', menu: 'Menu name', heading: 'Heading text', video: 'Video title' };

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
    current: 'main',
    pages: [{ id: 'main', title: '', slug: '', color: DEFAULT_COLOR, blocks: [newBlock('link')] }]
  };
}

function newBlock(type, target = '') {
  return { id: newId('b'), type, label: '', url: '', text: '', color: '', target };
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
    pages: state.pages.map((p, i) => ({
      slug: i === 0 ? '' : p.slug,
      title: p.title.trim(),
      color: normColor(p.color) || DEFAULT_COLOR,
      blocks: p.blocks.map((b) => {
        if (b.type === 'text') return { type: 'text', text: b.text };
        const out = { type: b.type, label: b.label.trim() };
        if (b.type === 'link' || b.type === 'video') out.url = b.url.trim();
        if (b.type === 'menu') out.page = byId.has(b.target) ? byId.get(b.target) : '#missing';
        if ((b.type === 'link' || b.type === 'menu' || b.type === 'heading') && b.color) out.color = b.color;
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
    current: 'main',
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
    seq = Math.max(seq, Number(d.seq) || 1000);
    return true;
  } catch (e) {
    return false;
  }
}
function changed() {
  saveDraft();
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

function show(name) {
  for (const id of ['loading', 'screen-login', 'screen-editor', 'screen-saved']) {
    $(id).hidden = id !== name;
  }
  document.body.classList.toggle('tm-board', name === 'screen-login');
  window.scrollTo(0, 0);
}

function fillEmboss() {
  document.querySelectorAll('[data-emboss]').forEach((el) => {
    el.innerHTML = `<span class="lt-letters" aria-hidden="true">${embossHtml(el.getAttribute('data-emboss'))}</span>`;
  });
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
  btn.textContent = 'Checking…';
  $('login-error').hidden = true;
  const { status, data } = await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
  btn.disabled = false;
  btn.textContent = 'Unlock';
  if (status === 200) {
    $('pw').value = '';
    const next = afterLogin;
    afterLogin = null;
    openEditor();
    if (next) next();
    return;
  }
  if (data.setup) return setupError(data.error);
  $('login-error').textContent = data.error || 'Could not unlock. Try again.';
  $('login-error').hidden = false;
});

$('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' });
  showLogin('');
});

// --------------------------------------------------------------- editor ---

function openEditor() {
  show('screen-editor');
  renderAll();
}

function renderAll() {
  const pg = page();
  $('pname').value = pg.title;
  $('addr').value = isMain(pg) ? state.tagSlug : pg.slug;
  $('addr-label').textContent = isMain(pg) ? 'Tag address' : 'Page address';
  $('addr-prefix').textContent = isMain(pg) ? `${location.host}/` : `…/${state.tagSlug || 'tag'}/`;
  $('delete-page').hidden = isMain(pg);
  renderSwatches();
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
    ? renderPageHtml(data, pageData, { tagSlug: state.tagSlug || 'tag', compact: true })
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
  if (isMain(pg)) return slugProblem(state.tagSlug, { isTag: true });
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
    saveDraft();
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

$('delete-page').addEventListener('click', () => {
  const pg = page();
  if (isMain(pg)) return;
  if (!confirm(`Delete the page "${pg.title || 'Untitled'}"? Menu strips that open it will be removed too.`)) return;
  state.pages = state.pages
    .filter((p) => p.id !== pg.id)
    .map((p) => ({ ...p, blocks: p.blocks.filter((b) => !(b.type === 'menu' && b.target === pg.id)) }));
  state.current = state.pages[0].id;
  saveDraft();
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
    const max = t === 'video' ? LIMITS.videoTitle : LIMITS.label;
    h += `<input type="text" data-field="label" value="${esc(b.label)}" placeholder="${esc(LABEL_HINTS[t])}" aria-label="${esc(LABEL_HINTS[t])}" maxlength="${max}">`;
  }
  if (t === 'link') {
    h += `<input type="url" data-field="url" value="${esc(b.url)}" placeholder="https://" aria-label="Link address" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="url">`;
    h += '<p class="tm-error" data-msg="url" role="alert" hidden>Use a link that starts with https:// or http://</p>';
    h += '<p class="tm-hint" data-msg="empty" hidden>No link yet: the strip shows faded and can\'t be tapped until you add one.</p>';
  }
  if (t === 'text') {
    h += `<textarea data-field="text" rows="5" placeholder="Write anything…" aria-label="Text" maxlength="${LIMITS.text}">${esc(b.text)}</textarea>`;
    h += '<p class="tm-hint">Add a link inside text like this: <span class="tm-code">[words](https://…)</span></p>';
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
  if (t === 'link' || t === 'menu' || t === 'heading') {
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
  } else {
    b[field] = e.target.value;
    updateBlockMessages(b);
  }
  changed();
});

$('block-list').addEventListener('change', (e) => {
  const b = blockFromEvent(e);
  if (!b || e.target.getAttribute('data-field') !== 'target') return;
  if (e.target.value === '__new') {
    const np = makePage(b.label || 'New page');
    state.pages.push(np);
    b.target = np.id;
  } else {
    b.target = e.target.value;
  }
  saveDraft();
  renderBlocks();
  renderLive();
});

$('block-list').addEventListener('click', (e) => {
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
    if (hasContent && !confirm('Remove this block?')) return;
    blocks.splice(i, 1);
    renderBlocks();
  } else if (act === 'reset-color') {
    b.color = '';
    renderBlocks();
  }
  saveDraft();
  renderLive();
});

function renderAddRow() {
  $('add-row').innerHTML = ['link', 'text', 'video', 'menu', 'heading'].map((t) =>
    `<button type="button" class="tm-add" data-add="${t}">${svg(ICONS[t], 20, 2)}${TYPE_NAMES[t]}</button>`
  ).join('');
}

$('add-row').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  const t = btn.getAttribute('data-add');
  const pg = page();
  if (pg.blocks.length >= LIMITS.blocks) return alert(`A page can have at most ${LIMITS.blocks} blocks.`);
  const others = state.pages.filter((p) => p.id !== pg.id);
  const b = newBlock(t, t === 'menu' && others[0] ? others[0].id : '');
  pg.blocks.push(b);
  saveDraft();
  renderBlocks();
  renderLive();
  const card = cardFor(b);
  const first = card && card.querySelector('input[type="text"], textarea');
  if (first) first.focus();
  if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

// ------------------------------------------------------------ open tag ---

const dialog = $('open-dialog');

$('open-btn').addEventListener('click', () => {
  $('open-prefix').textContent = `${location.host}/`;
  $('open-slug').value = '';
  $('open-error').hidden = true;
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  setTimeout(() => $('open-slug').focus(), 50);
});
$('open-cancel').addEventListener('click', () => dialog.close());
$('open-slug').addEventListener('input', (e) => {
  const v = e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/^.*\//, '');
  if (v !== e.target.value) e.target.value = v;
});

function hasWork() {
  return state.pages.length > 1 || state.tagSlug || state.pages[0].title ||
    state.pages[0].blocks.some((b) => b.label || b.url || b.text);
}

$('open-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const slug = $('open-slug').value.trim();
  const problem = slugProblem(slug, { isTag: true });
  if (problem) {
    $('open-error').textContent = problem;
    $('open-error').hidden = false;
    return;
  }
  if (hasWork() && state.loadedSlug !== slug && !confirm('Open this tag? Unsaved changes to the current one will be lost.')) return;
  $('open-go').disabled = true;
  $('open-go').textContent = 'Opening…';
  const ok = await openTag(slug, (msg) => {
    $('open-error').textContent = msg;
    $('open-error').hidden = false;
  });
  $('open-go').disabled = false;
  $('open-go').textContent = 'Open';
  if (ok) dialog.close();
});

$('new-tag').addEventListener('click', () => {
  if (hasWork() && !confirm('Start a new tag? Unsaved changes to the current one will be lost.')) return;
  state = blankState();
  saveDraft();
  dialog.close();
  openEditor();
});

async function openTag(slug, onError) {
  const { status, data } = await api(`/api/tag/${encodeURIComponent(slug)}`);
  if (status === 200) {
    state = fromData(data.slug, data.tag, data.sha);
    saveDraft();
    openEditor();
    if (data.warnings && data.warnings.length) showSaveErrors(['This tag has problems to fix before it can be saved:', ...data.warnings]);
    return true;
  }
  if (status === 401 && data.login) {
    if (dialog.open) dialog.close();
    afterLogin = () => openTag(slug, () => {});
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

$('save-btn').addEventListener('click', async () => {
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

  const btn = $('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const sha = state.loadedSlug === slug ? state.sha : '';
  let res = await api(`/api/tag/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify({ tag, sha }) });
  if (res.status === 409 && res.data.exists) {
    if (confirm(`A tag already exists at /${slug}. Replace it with this one?`)) {
      res = await api(`/api/tag/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify({ tag, overwrite: true }) });
    } else {
      btn.disabled = false;
      btn.textContent = 'Save tag';
      return showSaveErrors(['Not saved. Pick a different tag address, or use Open tag to edit the existing one.']);
    }
  }
  btn.disabled = false;
  btn.textContent = 'Save tag';

  if (res.status === 200) {
    state.loadedSlug = slug;
    state.sha = res.data.sha || '';
    writeDraft();
    showSaved(url, await copied);
    return;
  }
  if (res.status === 401 && res.data.login) {
    showLogin('Please unlock again, then tap Save tag. Your changes are kept.');
    return;
  }
  if (res.data.setup) return showSaveErrors(['The site is not set up yet:', res.data.error]);
  showSaveErrors([res.data.error || 'Could not save.', ...((res.data.errors || []).slice(1))]);
});

// ---------------------------------------------------------------- saved ---

function showSaved(url, copied) {
  savedUrl = url;
  $('saved-url').textContent = url;
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
    if (wanted && !slugProblem(wanted, { isTag: true }) && wanted !== state.loadedSlug) {
      openEditor();
      await openTag(wanted, (msg) => showSaveErrors([msg]));
    } else {
      openEditor();
    }
    return;
  }
  if (data.setup) return setupError(data.error);
  if (wanted) afterLogin = () => openTag(wanted, (msg) => showSaveErrors([msg]));
  showLogin('');
}

start();
