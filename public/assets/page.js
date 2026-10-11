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
