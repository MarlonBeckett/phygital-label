// Tag pages: swap a video thumbnail for the privacy-friendly YouTube player
// only when someone taps it. Without this script the thumbnail still links
// to the video on YouTube.
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[data-yt]');
  if (!a) return;
  var id = a.getAttribute('data-yt');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
  e.preventDefault();
  var frame = document.createElement('iframe');
  frame.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
  frame.title = a.getAttribute('aria-label') || 'YouTube video';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  var box = document.createElement('div');
  box.className = 'lt-player';
  box.appendChild(frame);
  a.replaceWith(box);
});

// Notes the owner marked "Anyone can edit": tap Edit, change the text, Save.
// The note is saved to the site (no login); everyone sees it after the site
// updates, about a minute later.
var EDIT_MAX = 1000;

function noteText(note) {
  return note.getAttribute('data-text') !== null ? note.getAttribute('data-text') : note.querySelector('p').textContent;
}

// Like replaceChildren, which older iPhones (iOS 13 and before) lack.
function setChildren(el, nodes) {
  el.textContent = '';
  for (var i = 0; i < nodes.length; i++) el.appendChild(nodes[i]);
}

function closeEditor(note, text) {
  var p = document.createElement('p');
  p.textContent = text;
  note.setAttribute('data-text', text);
  setChildren(note, [p, makeEditRow()]);
}

function makeEditRow() {
  var row = document.createElement('div');
  row.className = 'lt-edit-row';
  var badge = document.createElement('span');
  badge.className = 'lt-edit-badge';
  badge.textContent = 'Anyone can edit';
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'lt-edit-btn';
  b.setAttribute('data-edit-open', '');
  b.textContent = 'Edit';
  row.appendChild(badge);
  row.appendChild(b);
  return row;
}

function openEditor(note) {
  var was = noteText(note);
  var box = document.createElement('textarea');
  box.className = 'lt-edit-box';
  box.value = was;
  box.maxLength = EDIT_MAX;
  box.rows = Math.min(12, Math.max(4, was.split('\n').length + 1));
  box.setAttribute('aria-label', 'Edit this note');
  var count = document.createElement('p');
  count.className = 'lt-edit-msg';
  var msg = document.createElement('p');
  msg.className = 'lt-edit-msg';
  msg.setAttribute('role', 'status');
  msg.textContent = 'Anyone with this sticker can edit this note. Links won’t work here.';
  var save = document.createElement('button');
  save.type = 'button';
  save.className = 'lt-edit-btn lt-edit-save';
  save.textContent = 'Save';
  var cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'lt-edit-btn';
  cancel.textContent = 'Cancel';
  var row = document.createElement('div');
  row.className = 'lt-edit-row';
  row.appendChild(cancel);
  row.appendChild(save);
  function counter() { count.textContent = box.value.length + ' / ' + EDIT_MAX; }
  box.addEventListener('input', counter);
  counter();
  setChildren(note, [box, count, msg, row]);
  box.focus();

  cancel.addEventListener('click', function () { closeEditor(note, was); });
  save.addEventListener('click', function () {
    save.disabled = true;
    cancel.disabled = true;
    msg.textContent = 'Saving…';
    fetch('/api/visitor-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag: note.getAttribute('data-edit-tag'),
        page: note.getAttribute('data-edit-page'),
        block: Number(note.getAttribute('data-edit-block')),
        was: was,
        text: box.value
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (r.ok) {
        closeEditor(note, r.data.text);
        var done = document.createElement('p');
        done.className = 'lt-edit-msg';
        done.setAttribute('role', 'status');
        done.textContent = r.data.unchanged ? 'No changes.' : 'Saved. Everyone sees it in about a minute.';
        note.appendChild(done);
        return;
      }
      if (r.data && r.data.changed && typeof r.data.current === 'string') {
        // Someone else saved first: show their version to edit from.
        was = r.data.current;
        box.value = was;
        counter();
      }
      msg.textContent = (r.data && r.data.error) || 'Couldn’t save. Try again.';
      save.disabled = false;
      cancel.disabled = false;
    }, function () {
      msg.textContent = 'No connection. Check your internet and try again.';
      save.disabled = false;
      cancel.disabled = false;
    });
  });
}

document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('[data-edit-open]');
  if (!btn) return;
  var note = btn.closest('.lt-editable');
  if (note) openEditor(note);
});

// File stacks: tap a photo, video or audio file to view it here; other files
// (PDFs and so on) open in the phone's own viewer. If the owner switched on
// "Anyone can upload", Add a file puts a new file in the stack.
var MAX_UPLOAD = 5 * 1024 * 1024;

// A file the owner since deleted or hid: drop its broken thumbnail.
document.addEventListener('error', function (e) {
  var img = e.target;
  if (img && img.tagName === 'IMG' && img.closest && img.closest('.lt-file-card')) {
    var li = img.closest('li');
    if (li) li.parentNode.removeChild(li);
  }
}, true);

function closeViewer() {
  var v = document.querySelector('.lt-viewer');
  if (v) v.parentNode.removeChild(v);
  document.removeEventListener('keydown', viewerKeys);
}
function viewerKeys(e) { if (e.key === 'Escape') closeViewer(); }

function openViewer(card) {
  var kind = card.getAttribute('data-kind');
  var href = card.getAttribute('href');
  var name = card.getAttribute('data-name') || '';
  var box = document.createElement('div');
  box.className = 'lt-viewer';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', name);
  var media;
  if (kind === 'image') { media = document.createElement('img'); media.alt = name; }
  else { media = document.createElement(kind); media.controls = true; if (kind === 'video') media.playsInline = true; }
  media.src = href;
  var bar = document.createElement('div');
  bar.className = 'lt-viewer-bar';
  var title = document.createElement('span');
  title.textContent = name;
  var open = document.createElement('a');
  open.href = href;
  open.textContent = 'Open';
  var close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.addEventListener('click', closeViewer);
  bar.appendChild(title);
  bar.appendChild(open);
  bar.appendChild(close);
  box.appendChild(bar);
  box.appendChild(media);
  box.addEventListener('click', function (e) { if (e.target === box) closeViewer(); });
  document.body.appendChild(box);
  document.addEventListener('keydown', viewerKeys);
  close.focus();
}

document.addEventListener('click', function (e) {
  var card = e.target.closest && e.target.closest('.lt-file-card');
  if (!card) return;
  var kind = card.getAttribute('data-kind');
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return; // opens normally
  e.preventDefault();
  openViewer(card);
});

function stackMessage(stack, text) {
  var msg = stack.querySelector('.lt-stack-msg');
  if (!msg) {
    msg = document.createElement('p');
    msg.className = 'lt-edit-msg lt-stack-msg';
    msg.setAttribute('role', 'status');
    stack.appendChild(msg);
  }
  msg.textContent = text;
}

function addCard(stack, file, localUrl) {
  var list = stack.querySelector('.lt-file-stack');
  var empty = stack.querySelector('.lt-stack-empty');
  if (empty) empty.parentNode.removeChild(empty);
  var li = document.createElement('li');
  var a = document.createElement('a');
  a.className = 'lt-file-card';
  a.href = file.kind === 'image' || file.kind === 'video' || file.kind === 'audio' ? localUrl : '/files/' + file.ref;
  a.setAttribute('data-kind', file.kind);
  a.setAttribute('data-name', file.name);
  if (file.kind === 'image') {
    var img = document.createElement('img');
    img.src = localUrl;
    img.alt = '';
    a.appendChild(img);
  } else {
    var t = document.createElement('span');
    t.className = 'lt-file-type';
    var m = file.name.match(/\.([a-z0-9]+)$/i);
    t.textContent = m ? m[1].toUpperCase() : 'FILE';
    a.appendChild(t);
  }
  var label = document.createElement('span');
  label.className = 'lt-file-label';
  label.textContent = file.name;
  a.appendChild(label);
  li.appendChild(a);
  list.appendChild(li);
}

document.addEventListener('change', function (e) {
  var input = e.target;
  if (!input.hasAttribute || !input.hasAttribute('data-stack-upload')) return;
  var stack = input.closest('.lt-files');
  var file = input.files && input.files[0];
  input.value = '';
  if (!stack || !file) return;
  if (file.size > MAX_UPLOAD) { stackMessage(stack, 'Files can be up to 5 MB here. That one is ' + (file.size / 1048576).toFixed(1) + ' MB.'); return; }
  input.disabled = true;
  stackMessage(stack, 'Uploading ' + file.name + '…');
  var reader = new FileReader();
  reader.onerror = function () { input.disabled = false; stackMessage(stack, 'Couldn’t read that file. Try again.'); };
  reader.onload = function () {
    var base64 = String(reader.result).replace(/^data:[^,]*,/, '');
    fetch('/api/visitor-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-Stack-Tag': stack.getAttribute('data-stack-tag'),
        'X-Stack-Page': stack.getAttribute('data-stack-page'),
        'X-Stack-Block': stack.getAttribute('data-stack-block'),
        'X-File-Name': encodeURIComponent(file.name)
      },
      body: base64
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      input.disabled = false;
      if (!r.ok) { stackMessage(stack, (r.data && r.data.error) || 'Couldn’t upload. Try again.'); return; }
      addCard(stack, r.data.file, URL.createObjectURL(file));
      stackMessage(stack, 'Added ' + r.data.file.name + '. Everyone sees it in about a minute.');
    }, function () {
      input.disabled = false;
      stackMessage(stack, 'No connection. Check your internet and try again.');
    });
  };
  reader.readAsDataURL(file);
});
