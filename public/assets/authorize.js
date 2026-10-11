// The "Allow Claude?" page: if this phone is already unlocked, hide the
// password box. (The login cookie is not sent when arriving from another
// site, so the server can't tell on its own.)
fetch('/api/session', { credentials: 'same-origin' }).then((res) => {
  if (!res.ok) return;
  const field = document.getElementById('pw-field');
  const ok = document.getElementById('pw-ok');
  if (field) field.hidden = true;
  if (ok) ok.hidden = false;
}, () => {});
