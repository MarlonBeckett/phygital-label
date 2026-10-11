// Server tests: sign-in, the Claude connector (OAuth + MCP), the label maker's
// API and settings. Needs the site and the GitHub stand-in running:
//
//   node dev/mock-github.mjs public/tags        (one terminal)
//   npx wrangler pages dev public --port 8788   (another, with .dev.vars
//                                                pointing GITHUB_API at the stand-in)
//   node dev/test-api.mjs
//
// It briefly writes public/tags/_settings.json to act like a deploy of the
// settings, and removes it again at the end.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const B = process.env.SITE || 'http://localhost:8788';
const MOCK = process.env.MOCK || 'http://localhost:8790';
const root = fileURLToPath(new URL('..', import.meta.url));
const pw = fs.readFileSync(`${root}.dev.vars`, 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m)[1].trim();
const deployed = `${root}public/tags/_settings.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString('base64url');
const id = `t${Date.now() % 100000}`;

let fails = 0;
let count = 0;
function ok(cond, label, extra = '') {
  count++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}
const control = (body) => fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());

for (let i = 0; i < 60; i++) { try { await fetch(`${B}/new`); break; } catch { await sleep(1000); } }
await control({ reset: true });
try { fs.unlinkSync(deployed); } catch { /* not there */ }
await sleep(11000); // let the site's settings cache see "no settings file"

// ------------------------------------------------------------- unlock ---
async function login() {
  const r = await fetch(`${B}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify({ password: pw }) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
const cookie = await login();
ok(!!cookie, 'unlock with the password');
const H = { Cookie: cookie, Origin: B, 'Content-Type': 'application/json' };
const api = async (path, opts = {}) => {
  const r = await fetch(B + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  let data = {};
  try { data = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, data, headers: r.headers };
};

// --------------------------------------------------------------- OAuth ---
let r = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' });
ok(r.status === 401 && /resource_metadata=/.test(r.headers.get('www-authenticate') || ''), '/mcp without sign-in → 401 with resource_metadata');
for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
  const j = await (await fetch(B + p)).json();
  ok(j.resource === `${B}/mcp`, `GET ${p}`);
}
const meta = await (await fetch(`${B}/.well-known/oauth-authorization-server`)).json();
ok(meta.token_endpoint === `${B}/oauth/token`, 'authorization server metadata');

const register = (uris, name = 'Claude') => fetch(meta.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: uris }) });
const redirect = 'https://claude.ai/api/mcp/auth_callback';
r = await register([redirect]);
const client = await r.json();
ok(r.status === 201 && client.client_id, 'register a client');
ok((await register(['http://evil.example/cb'])).status === 400, 'register refuses plain http to another site');
ok((await register(['https://a;b.com/cb'])).status === 400, 'register refuses odd host names');
ok((await register(Array.from({ length: 4 }, (_, i) => `https://claude.ai/${i}/${'x'.repeat(450)}`))).status === 400, 'register refuses overlong redirect lists');
const longClient = await (await register(Array.from({ length: 3 }, (_, i) => `https://claude.ai/${i}/${'x'.repeat(440)}`))).json();

const verifier = b64u(crypto.randomBytes(32));
const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
const base = { response_type: 'code', client_id: client.client_id, redirect_uri: redirect, state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256', scope: 'labels', resource: `${B}/mcp` };
const authUrl = (over = {}) => `${meta.authorization_endpoint}?${new URLSearchParams({ ...base, ...over })}`;

r = await fetch(authUrl());
let page = await r.text();
ok(r.status === 200 && page.includes('Connect Claude?') && (r.headers.get('content-security-policy') || '').includes("form-action 'self' https://claude.ai"), 'Allow page renders with claude.ai as a form target');
ok(!page.includes('no-referrer') && r.headers.get('referrer-policy') === 'same-origin', 'Allow page keeps the Origin header (no no-referrer)');
ok(page.includes('name="password"') && !page.includes('authorize.js'), 'Allow page always asks for the password');
ok(!page.includes('Careful:'), 'no warning for Claude\'s own address');
r = await fetch(authUrl({ client_id: longClient.client_id, redirect_uri: `https://claude.ai/0/${'x'.repeat(440)}` }));
ok(r.status === 200, 'a long (but allowed) client id still works');
r = await fetch(authUrl({ redirect_uri: 'https://evil.example/cb' }));
ok(r.status === 400, 'unregistered redirect refused');
r = await fetch(authUrl({ response_type: 'token' }), { redirect: 'manual' });
ok(r.status === 400 && !r.headers.get('location'), 'bad request shows a page instead of redirecting');
const other = await (await register(['https://example.org/cb'], 'Some app')).json();
page = await (await fetch(authUrl({ client_id: other.client_id, redirect_uri: 'https://example.org/cb' }))).text();
ok(page.includes('Careful:'), 'warning shown for a non-Claude address');

const post = (fields, headers = { Origin: B }) => fetch(meta.authorization_endpoint, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams({ ...base, ...fields }).toString()
});
ok((await post({ decision: 'allow' }, { Origin: B, Cookie: cookie })).status === 401, 'an unlocked phone still needs the password');
ok((await post({ decision: 'allow', password: 'wrong-password-123456' })).status === 401, 'wrong password refused');
ok((await post({ decision: 'allow', password: pw }, { Origin: 'https://evil.example' })).status === 403, 'cross-site POST blocked');
ok((await post({ decision: 'allow', password: pw }, { Origin: 'null' })).status === 403, 'Origin null without Sec-Fetch-Site blocked');
r = await post({ decision: 'deny' });
ok(r.status === 302 && new URL(r.headers.get('location')).searchParams.get('error') === 'access_denied', 'deny → access_denied');
// What real browsers send from the Allow page: possibly Origin null, always Sec-Fetch-Site.
r = await post({ decision: 'allow', password: pw }, { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' });
const loc = new URL(r.headers.get('location') || 'http://x');
const code = loc.searchParams.get('code');
ok(r.status === 302 && loc.origin === 'https://claude.ai' && code && loc.searchParams.get('state') === 'xyz', 'allow (as a browser sends it) → code + state');

const token = (params) => fetch(meta.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
ok((await token({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier })).status === 400, 'token needs client_id');
ok((await token({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.client_id, code_verifier: b64u(crypto.randomBytes(32)) })).status === 400, 'wrong PKCE verifier refused');
r = await token({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.client_id, code_verifier: verifier });
const tokens = await r.json();
ok(r.status === 200 && tokens.access_token && tokens.refresh_token, 'code → tokens');
r = await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id });
const fresh = await r.json();
ok(r.status === 200 && fresh.access_token, 'refresh token works');
ok((await token({ grant_type: 'refresh_token', refresh_token: tokens.access_token })).status === 400, 'an access token is not a refresh token');

// ----------------------------------------------------------------- MCP ---
let rpcId = 0;
const rpc = async (method, params, bearer = fresh.access_token) => {
  const res = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  return res.status === 202 ? { status: 202 } : res.json();
};
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
let j = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
ok(j.result?.protocolVersion === '2025-06-18' && j.result.capabilities.tools, 'initialize');
r = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fresh.access_token}` }, body: '{"jsonrpc":"2.0","method":"notifications/initialized"}' });
ok(r.status === 202, 'notification → 202');
j = await rpc('tools/list', {});
ok(j.result?.tools.length === 6, 'six tools');
const label = { pages: [
  { slug: '', title: 'Espresso machine', color: '#AD161C', blocks: [{ type: 'text', text: 'Descale monthly.' }, { type: 'menu', label: 'Recipes', page: 'recipes' }] },
  { slug: 'recipes', title: 'Recipes', color: '#161616', blocks: [{ type: 'link', label: 'Flat white', url: '' }] }] };
const addr = `${id}-espresso`;
let res = await call('create_label', { address: addr, label });
ok(!res.isError && res.content[0].text.includes(`${B}/${addr}`), 'create_label');
res = await call('list_labels', {});
ok(res.content[0].text.includes(`/${addr}`), 'list_labels shows it');
ok((await call('create_label', { address: addr, label })).isError, 'create_label refuses a taken address');
ok((await call('create_label', { address: 'mcp', label })).isError, 'create_label refuses a reserved address');
ok((await call('create_label', { address: `${id}-bad`, label: { pages: [{ slug: '', title: 'x', blocks: [{ type: 'link', label: 'y', url: 'javascript:alert(1)' }] }] } })).isError, 'create_label refuses javascript: links');
res = await call('get_label', { address: addr });
const got = JSON.parse(res.content[0].text);
ok(got.label.pages.length === 2, 'get_label');
got.label.pages[0].title = 'Espresso';
ok(!(await call('update_label', { address: addr, label: got.label, sha: got.sha })).isError, 'update_label with sha');
ok((await call('update_label', { address: addr, label: got.label, sha: got.sha })).isError, 'update_label with a stale sha refused');
ok((await call('update_label', { address: `${id}-nope`, label: got.label })).isError, 'update_label on a missing label refused');
ok(!(await call('delete_label', { address: addr })).isError, 'delete_label');
ok((await call('get_label', { address: addr })).isError, 'deleted label is gone');
ok((await rpc('tools/list', {}, 'garbage.token')).error === 'invalid_token', 'bad token refused');

// ----------------------------------------------------- label maker API ---
const tagBody = (title) => ({ pages: [{ slug: '', title, blocks: [] }] });
j = await api('/api/tags');
ok(j.status === 200 && j.data.repo && j.data.tokenExpires && !j.data.tags.some((t) => t.slug.startsWith('_')), 'list labels (+ token expiry, no settings file)');
const a = `${id}-cam`;
let p = await api(`/api/tag/${a}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('Old camera') }) });
ok(p.status === 200 && p.data.sha, 'save a new label');
const firstSha = p.data.sha;
ok((await api(`/api/tag/${a}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('X') }) })).data.exists, 'same address again → exists');
p = await api(`/api/tag/${a}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('Newer'), sha: firstSha }) });
ok(p.status === 200, 'update with its sha');
p = await api(`/api/tag/${a}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('Stale'), sha: firstSha }) });
ok(p.status === 409 && p.data.github && !p.data.exists, 'stale sha → conflict (not "exists")');
p = await api(`/api/tag/${a}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('Mine'), overwrite: true }) });
ok(p.status === 200, 'overwrite after a conflict');
p = await api(`/api/tag/${a}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('Replacement'), replace: true }) });
ok(p.status === 200 && p.data.movedTo === `${a}-2`, 'replace moves the old label to -2');
j = await api(`/api/tag/${a}-2`);
ok(j.data.tag?.pages[0].title === 'Mine', 'the moved label kept its content');

// Replace refused halfway (GitHub said no) must not leave a stray copy…
const rb = `${id}-rb`;
await api(`/api/tag/${rb}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('Keep me') }) });
await control({ failPut: [{ name: `${rb}.json`, status: 409 }] });
p = await api(`/api/tag/${rb}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('New'), replace: true }) });
ok(p.status !== 200, 'refused replace reports the failure');
ok((await api(`/api/tag/${rb}-2`)).status === 404, 'and removes its copy again');
ok((await api(`/api/tag/${rb}`)).data.tag?.pages[0].title === 'Keep me', 'and the original is untouched');
// …but an unclear failure (5xx: it may have gone through) keeps the copy.
await control({ failPut: [{ name: `${rb}.json`, status: 500 }] });
p = await api(`/api/tag/${rb}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('New'), replace: true }) });
ok(p.status === 502 && p.data.movedTo === `${rb}-2` && /safe at/.test(p.data.error), 'unclear replace failure says where the old label is');
ok((await api(`/api/tag/${rb}-2`)).data.tag?.pages[0].title === 'Keep me', 'and keeps the copy');
await api(`/api/tag/${rb}-2`, { method: 'DELETE', body: '{}' });

// A broken file gives a clear error instead of crashing the editor.
await control({ put: { name: `${id}-broken.json`, text: '{}' } });
j = await api(`/api/tag/${id}-broken`);
ok(j.status === 422 && /broken/.test(j.data.error), 'broken label file → clear error');
ok((await call('get_label', { address: `${id}-broken` })).isError, 'and Claude gets an error too');
await control({ remove: `${id}-broken.json` });
await control({ put: { name: `${id}-empty.json`, text: '{"v":1,"pages":[]}' } });
ok((await api(`/api/tag/${id}-empty`)).status === 422, 'label with no pages → clear error');
await control({ remove: `${id}-empty.json` });
ok((await api('/api/settings', { method: 'PUT', body: 'null' })).status === 400, 'settings with a null body → 400, not a crash');
// The login cookie only works on the address it was made for.
try {
  ok((await fetch(`${B.replace('localhost', '127.0.0.1')}/api/session`, { headers: { Cookie: cookie } })).status === 401, 'login cookie refused on another address');
} catch { ok(true, 'login cookie refused on another address (127.0.0.1 not reachable, skipped)'); }

j = await api(`/api/tag/${a}-2`, { method: 'DELETE', body: '{}' });
ok(j.status === 200, 'delete a label');

// Expired GitHub token: clear signal for the menu, pages still work.
await control({ expired: true });
j = await api('/api/tags');
ok(j.status === 502 && j.data.github === 401 && j.data.repo, 'expired token → github 401 for the menu');
ok((await fetch(`${B}/new`)).status === 200, 'the site itself still loads');
await control({ expired: false });
// The token works but can't see the repo (or GITHUB_REPO is wrong).
await control({ hidden: true });
j = await api('/api/tags');
ok(j.status === 502 && j.data.github === 404 && j.data.repo, 'repo out of reach → github 404 + the repo name');
await control({ hidden: false });

// --------------------------------------------------------------- files ---
// The browser sends files as base64 text (the server streams it to GitHub).
const upload = (name, bytes, isPrivate = false) => fetch(`${B}/api/files`, {
  method: 'POST',
  headers: { Cookie: cookie, Origin: B, 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent(name), 'X-File-Private': isPrivate ? '1' : '0' },
  body: Buffer.from(bytes).toString('base64')
}).then(async (x) => ({ status: x.status, data: await x.json() }));
const pdfBytes = Buffer.from('%PDF-1.4\n% test manual\n');
let up = await upload('My Manual (v2).pdf', pdfBytes);
ok(up.status === 200 && up.data.file.name === 'My-Manual-v2.pdf' && /^[a-z0-9]{16}$/.test(up.data.file.id) && !up.data.file.private, 'upload a public file (name cleaned, random id)');
const pubFile = up.data.file;
up = await upload('receipt.txt', Buffer.from('Bought 2026-10-11'), true);
ok(up.status === 200 && up.data.file.private, 'upload a private file');
const priv = up.data.file;
ok((await upload('page.html', Buffer.from('<script>alert(1)</script>'))).status === 400, 'risky type refused as public');
up = await upload('page.html', Buffer.from('<script>alert(1)</script>'), true);
ok(up.status === 200, 'risky type allowed as private');
const risky = up.data.file;
ok((await upload('big.bin', Buffer.alloc(10 * 1024 * 1024 + 3))).status === 413, 'over 10 MB refused');
ok((await upload('empty.txt', Buffer.alloc(0))).status !== 200, 'empty file refused');
ok((await upload('feed.rss', Buffer.from('<rss/>'))).status === 400, 'XML-like types refused as public');
ok((await upload('noext', Buffer.from('x'))).status === 400, 'files without an extension refused as public');
up = await upload('firmware.zip', Buffer.from('PK'));
ok(up.status === 200 && !up.data.file.private, 'download types like zip can be public');
const zipFile = up.data.file;
up = await upload('big-ok.bin', Buffer.alloc(3 * 1024 * 1024, 7), true);
r = await fetch(`${B}/api/file/${up.data.file.ref}?private=1`, { headers: { Cookie: cookie } });
ok(up.status === 200 && Buffer.from(await r.arrayBuffer()).equals(Buffer.alloc(3 * 1024 * 1024, 7)), 'a 3 MB file streams up and back intact');
const bigFile = up.data.file;
ok((await fetch(`${B}/api/files`, { method: 'POST', headers: { 'X-File-Name': 'x.txt' }, body: 'x' })).status !== 200, 'upload needs the password');

// A label that shows the public file.
const fl = `${id}-files`;
await api(`/api/tag/${fl}`, { method: 'PUT', body: JSON.stringify({ tag: { pages: [{ slug: '', title: 'Files', blocks: [{ type: 'file', label: 'Manual', file: pubFile.ref }] }] } }) });
j = await api('/api/files');
const listed = (ref) => j.data.files.find((f) => f.ref === ref);
res = await call('list_files', {});
ok(!res.isError && res.content[0].text.includes(pubFile.ref) && /private \(cannot go on labels\)/.test(res.content[0].text), 'Claude can list files (public refs, private marked)');
ok(j.status === 200 && listed(pubFile.ref) && listed(priv.ref)?.private, 'list shows public and private files');
ok(JSON.stringify(listed(pubFile.ref).usedBy) === JSON.stringify([fl]), 'list says which labels use a file');
ok((await api(`/api/tag/${fl}`, { method: 'PUT', body: JSON.stringify({ tag: { pages: [{ slug: '', title: 'x', blocks: [{ type: 'file', file: '../../etc/passwd' }] }] } }) })).status === 400, 'file block must point at an upload');

r = await fetch(`${B}/api/file/${pubFile.ref}`, { headers: { Cookie: cookie } });
ok(r.status === 200 && r.headers.get('content-type') === 'application/pdf' && /inline/.test(r.headers.get('content-disposition')) && Buffer.from(await r.arrayBuffer()).equals(pdfBytes), 'view a public file');
r = await fetch(`${B}/api/file/${priv.ref}?private=1`, { headers: { Cookie: cookie } });
ok(r.status === 200 && (await r.text()) === 'Bought 2026-10-11', 'view a private file');
r = await fetch(`${B}/api/file/${risky.ref}?private=1`, { headers: { Cookie: cookie } });
ok(r.headers.get('content-type') === 'application/octet-stream' && /attachment/.test(r.headers.get('content-disposition')) && r.headers.get('x-content-type-options') === 'nosniff', 'risky file always downloads');
ok((await fetch(`${B}/api/file/${priv.ref}?private=1`)).status === 401, 'private file needs the password');
ok((await fetch(`${B}/api/file/${pubFile.id}/..%2F..%2Fsecrets?private=1`, { headers: { Cookie: cookie } })).status === 400, 'no path tricks in file names');
ok((await fetch(`${B}/files/${pubFile.ref}`)).status === 404, 'files are only public on the site after a deploy');

await control({ failMove: true });
let pr = await api(`/api/file/${priv.ref}`, { method: 'PATCH', body: JSON.stringify({ wasPrivate: true, private: false }) });
ok(pr.status !== 200, 'an interrupted public/private switch reports it');
pr = await api(`/api/file/${priv.ref}`, { method: 'PATCH', body: JSON.stringify({ wasPrivate: true, private: false }) });
ok(pr.status === 200, 'and can simply be tried again');
j = await api('/api/files');
ok(listed(priv.ref) && !listed(priv.ref).private, 'and it is listed as public');
ok(j.data.files.filter((f) => f.ref === priv.ref).length === 1, 'a moved file exists exactly once');
ok((await api(`/api/file/${risky.ref}`, { method: 'PATCH', body: JSON.stringify({ wasPrivate: true, private: false }) })).status === 400, 'a risky file cannot be made public');
for (const f of [pubFile, risky, zipFile, bigFile]) await api(`/api/file/${f.ref}?private=${f.private ? 1 : 0}`, { method: 'DELETE' });
ok((await api(`/api/file/${priv.ref}?private=0`, { method: 'DELETE' })).status === 200, 'delete a file');
j = await api('/api/files');
ok(!j.data.files.some((f) => [pubFile.ref, priv.ref, risky.ref].includes(f.ref)), 'deleted files are gone');
await api(`/api/tag/${fl}`, { method: 'DELETE', body: '{}' });

// Deleting a label deletes its files, except ones another label also uses.
{
  const only = (await upload('only-a.jpg', Buffer.from('a'))).data.file;
  const shared = (await upload('shared.pdf', Buffer.from('%PDF-1.4'))).data.file;
  const spare = (await upload('spare.pdf', Buffer.from('%PDF-1.4'))).data.file;
  const la = `${id}-del-a`, lb = `${id}-del-b`;
  await api(`/api/tag/${la}`, { method: 'PUT', body: JSON.stringify({ tag: { pages: [{ slug: '', title: 'A', blocks: [
    { type: 'files', files: [only.ref, shared.ref], uploads: true }] }] } }) });
  await api(`/api/tag/${lb}`, { method: 'PUT', body: JSON.stringify({ tag: { pages: [{ slug: '', title: 'B', blocks: [{ type: 'file', file: shared.ref }] }] } }) });
  const stale = '0'.repeat(40);
  r = await api(`/api/tag/${la}`, { method: 'DELETE', body: JSON.stringify({ sha: stale }) });
  ok(r.status === 409 && (await api(`/api/tag/${la}`)).status === 200, 'a label changed since it was listed is not deleted');
  const listedSha = (await api('/api/tags')).data.tags.find((t) => t.slug === la).sha;
  r = await api(`/api/tag/${la}`, { method: 'DELETE', body: JSON.stringify({ sha: listedSha }) });
  ok(r.status === 200 && JSON.stringify(r.data.files) === JSON.stringify(['only-a.jpg']), 'delete reports the files it took', JSON.stringify(r.data));
  const left = (await api('/api/files')).data.files.map((f) => f.ref);
  ok((await api(`/api/tag/${la}`)).status === 404 && !left.includes(only.ref), 'label and its own file are gone from the repo');
  ok(left.includes(shared.ref) && left.includes(spare.ref), 'a file another label uses, and unused files, stay');
  r = await api(`/api/tag/${lb}`, { method: 'DELETE', body: '{}' });
  ok(r.status === 200 && !(await api('/api/files')).data.files.some((f) => f.ref === shared.ref), 'deleting the last label using a file deletes it');
  await api(`/api/file/${spare.ref}?private=0`, { method: 'DELETE' });
}

// ------------------------------------------------- notes anyone can edit ---
const ve = `${id}-log`;
const logTag = { pages: [{ slug: '', title: 'Log', blocks: [
  { type: 'text', text: 'Last oil change: never', editable: true },
  { type: 'text', text: 'Owner only' }] }] };
await api(`/api/tag/${ve}`, { method: 'PUT', body: JSON.stringify({ tag: logTag }) });
fs.writeFileSync(`${root}public/tags/${ve}.json`, JSON.stringify(logTag)); // as if deployed
await sleep(1500);
let ip = 0;
const visit = (body, headers = {}) => fetch(`${B}/api/visitor-edit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: B, 'CF-Connecting-IP': `198.51.100.${++ip % 250}`, ...headers },
  body: JSON.stringify({ tag: ve, page: '', block: 0, was: 'Last oil change: never', ...body })
}).then(async (x) => ({ status: x.status, data: await x.json() }));
page = await (await fetch(`${B}/${ve}`)).text();
ok(page.includes('class="lt-edit-btn"') && page.includes('data-edit-block="0"'), 'editable note has an Edit button on the page');
ok((page.match(/lt-edit-btn/g) || []).length === 1, 'other notes have no Edit button');
let v = await visit({ text: 'Last oil change: 2026-10-11\nby Sam [click](https://evil.example)' });
ok(v.status === 200 && v.data.text.startsWith('Last oil change: 2026-10-11'), 'a visitor can edit a marked note (no login)');
ok((await api(`/api/tag/${ve}`)).data.tag.pages[0].blocks[0].text.includes('by Sam'), 'the edit is saved');
v = await visit({ text: 'again' });
ok(v.status === 409 && v.data.changed && v.data.current.includes('by Sam'), 'stale edit refused, with the latest text to edit from');
r = await fetch(`${B}/api/visitor-edit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify({ text: 'x'.repeat(30000) }) });
ok(r.status === 413, 'oversized edit refused before reading it');
ok((await visit({ block: 1, was: 'Owner only', text: 'hacked' })).status === 403, 'unmarked notes cannot be edited');
ok((await visit({ was: (await api(`/api/tag/${ve}`)).data.tag.pages[0].blocks[0].text, text: 'x'.repeat(1001) })).status === 400, 'visitor text capped at 1000');
ok((await visit({ text: 'x' }, { Origin: 'https://evil.example' })).status === 403, 'edits from other sites blocked');
ok((await fetch(`${B}/api/visitor-edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 403, 'edits without an Origin blocked');
ok((await visit({ tag: '../x' })).status === 400, 'bad label address refused');
// Hourly limit per person.
let cur = (await api(`/api/tag/${ve}`)).data.tag.pages[0].blocks[0].text;
const same = { 'CF-Connecting-IP': '203.0.113.77' };
const hourly = [];
for (let n = 0; n < 7; n++) {
  const r2 = await visit({ was: cur, text: `edit ${n}` }, same);
  hourly.push(r2.status);
  if (r2.status === 200) cur = r2.data.text;
}
ok(hourly.slice(0, 6).every((x) => x === 200) && hourly[6] === 429, 'six edits an hour per person', JSON.stringify(hourly));
// Daily cap for the whole site: 9 earlier edits + 1 real one = the cap of 10,
// so the next is refused (which also proves real edits are being counted).
await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify({ clearCommits: true }) });
await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify({ fakeCommits: { count: 9, message: `Visitor edit on /${ve}` } }) });
v = await visit({ was: cur, text: 'tenth edit today' });
ok(v.status === 200, 'edits allowed up to the daily cap');
cur = v.data.text;
ok((await visit({ was: cur, text: 'eleventh' })).status === 429, 'daily cap for the whole site (counts real edits)');
await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify({ clearCommits: true }) });
await api(`/api/tag/${ve}`, { method: 'DELETE', body: '{}' });
fs.unlinkSync(`${root}public/tags/${ve}.json`);

// ------------------------------------------------ visitor uploads (stacks) ---
const st = `${id}-receipts`;
const stackTag = (uploads) => ({ pages: [{ slug: '', title: 'Receipts', blocks: [
  { type: 'files', label: 'Receipts', files: [], uploads },
  { type: 'files', label: 'Closed', files: [] }] }] });
await api(`/api/tag/${st}`, { method: 'PUT', body: JSON.stringify({ tag: stackTag(true), overwrite: true }) });
fs.writeFileSync(`${root}public/tags/${st}.json`, JSON.stringify(stackTag(true))); // as if deployed
await sleep(1500);
await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify({ clearCommits: true }) });
let uip = 0;
const vup = (name, bytes, headers = {}) => fetch(`${B}/api/visitor-upload`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain', Origin: B, 'CF-Connecting-IP': `192.0.2.${++uip % 250}`, 'X-Stack-Tag': st, 'X-Stack-Page': '', 'X-Stack-Block': '0', 'X-File-Name': encodeURIComponent(name), ...headers },
  body: Buffer.from(bytes).toString('base64')
}).then(async (x) => ({ status: x.status, data: await x.json() }));
page = await (await fetch(`${B}/${st}`)).text();
ok((page.match(/data-stack-upload/g) || []).length === 1, 'Add a file shows only on the stack that allows uploads');
let vu = await vup('Oil receipt.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
ok(vu.status === 200 && /^[a-z0-9]{16}\/Oil-receipt\.jpg$/.test(vu.data.file.ref), 'a visitor can add a file to an open stack (no login)');
const after = (await api(`/api/tag/${st}`)).data.tag;
ok(after.pages[0].blocks[0].files.includes(vu.data.file.ref), 'the label now lists the file');
r = await fetch(`${B}/api/file/${vu.data.file.ref}?private=0`, { headers: { Cookie: cookie } });
ok(r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])), 'the uploaded file is stored intact');
let msgs = await (await fetch(`${MOCK}/repos/x/y/commits?since=2000-01-01`)).json();
ok(msgs.filter((c) => c.commit.message.startsWith('Visitor upload to /')).length === 1, 'file and label saved in one commit');
ok((await vup('x.jpg', Buffer.from('x'), { 'X-Stack-Block': '1' })).status === 403, 'stacks without "Anyone can upload" refuse files');
ok((await vup('page.html', Buffer.from('<script>'))).status === 400, 'web-page files refused');
ok((await vup('x.jpg', Buffer.from('x'), { Origin: 'https://evil.example' })).status === 403, 'uploads from other sites blocked');
ok((await vup('big.jpg', Buffer.alloc(5 * 1024 * 1024 + 3))).status === 413, 'visitor files over 5 MB refused');
// Someone else saves in the middle of an upload: it rebuilds on their version.
await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify({ raceNextRef: true }) });
vu = await vup('race.jpg', Buffer.from('x'));
ok(vu.status === 200 && (await api(`/api/tag/${st}`)).data.tag.pages[0].blocks[0].files.includes(vu.data.file.ref), 'an upload racing another save still lands, once');
r = await fetch(`${B}/api/visitor-upload`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: B, 'CF-Connecting-IP': '192.0.2.201', 'X-Stack-Tag': st, 'X-Stack-Page': '', 'X-Stack-Block': '0', 'X-File-Name': 'bad.jpg' }, body: 'ab$=' });
ok(r.status === 400 && /damaged/.test((await r.json()).error), 'damaged uploads get a clear message');
ok((await vup('x.jpg', Buffer.from('x'), { 'X-Stack-Tag': '../etc' })).status === 400, 'bad label address refused');
const oneIp = { 'CF-Connecting-IP': '203.0.113.88' };
const three = [];
for (let n = 0; n < 4; n++) three.push((await vup(`r${n}.pdf`, Buffer.from('%PDF-1.4'), oneIp)).status);
ok(three.slice(0, 3).every((x) => x === 200) && three[3] === 429, '3 uploads an hour per person', JSON.stringify(three));
// Uploads and edits share the daily cap of 10 (5 uploads so far).
await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify({ fakeCommits: { count: 5, message: `Visitor edit on /${st}` } }) });
ok((await vup('late.jpg', Buffer.from('x'))).status === 429, 'uploads count towards the daily cap');
// And a daily byte budget (git keeps every file forever).
await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify({ clearCommits: true }) });
await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify({ fakeCommits: { count: 1, message: `Visitor upload to /${st}: big.pdf (${25 * 1024 * 1024} bytes)` } }) });
ok((await vup('more.jpg', Buffer.from('x'))).status === 429, 'daily upload budget (25 MB) enforced');
await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify({ clearCommits: true }) });
// The deployed copy says open, but the label was closed meanwhile: refused.
await api(`/api/tag/${st}`, { method: 'PUT', body: JSON.stringify({ tag: stackTag(false), overwrite: true }) });
ok((await vup('closed.jpg', Buffer.from('x'))).status === 403, 'a stack closed since the page was deployed refuses files');
// A full stack refuses more.
const full = stackTag(true);
full.pages[0].blocks[0].files = Array.from({ length: 50 }, (_, n) => `abcdefghijklmnop/f${n}.pdf`);
await api(`/api/tag/${st}`, { method: 'PUT', body: JSON.stringify({ tag: full, overwrite: true }) });
ok((await vup('one-more.jpg', Buffer.from('x'))).status === 409, 'a full stack (50 files) refuses more');
// Claude must pass a sha for labels visitors can change.
ok((await call('update_label', { address: st, label: full })).isError, 'Claude needs the current sha for labels visitors can change');
ok((await call('update_label', { address: st, label: full, sha: 'abc1234' })).isError, 'a made-up sha counts as no sha');
for (const f of (await api('/api/files')).data.files.filter((x) => (x.usedBy || []).includes(st))) await api(`/api/file/${f.ref}?private=0`, { method: 'DELETE' });
await api(`/api/tag/${st}`, { method: 'DELETE', body: '{}' });
fs.unlinkSync(`${root}public/tags/${st}.json`);

// ------------------------------------------------------------ settings ---
j = await api('/api/settings?health=1');
ok(j.status === 200 && j.data.health.repo === 'local/mock' && j.data.health.expires, 'settings + health');
ok((await api('/api/settings', { method: 'PUT', body: JSON.stringify({ font: 'regular' }) })).status === 200, 'save site font');
ok((await api('/api/settings')).data.settings.font === 'regular', 'site font reads back');
ok((await api('/api/settings', { method: 'PUT', body: JSON.stringify({ font: 'comic-sans' }) })).status === 400, 'bad font refused');
await api('/api/settings', { method: 'PUT', body: JSON.stringify({ font: 'label' }) });
r = await fetch(`${B}/api/backup`, { headers: H });
const backup = await r.json();
ok(r.status === 200 && /attachment; filename="labels-backup-/.test(r.headers.get('content-disposition')) && backup.tags[a], 'backup download');
ok((await fetch(`${B}/api/backup`)).status === 401, 'backup needs the password');

// "Deploy" settings and check the live site follows them.
ok((await fetch(`${B}/tags/_settings.json`)).status === 404, 'settings file is never public');
const pub = `${id}-pub`;
await api(`/api/tag/${pub}`, { method: 'PUT', body: JSON.stringify({ tag: tagBody('Public') }) });
fs.writeFileSync(`${root}public/tags/${pub}.json`, JSON.stringify(tagBody('Public')));
fs.writeFileSync(deployed, JSON.stringify({ v: 1, font: 'regular', epoch: 0 }));
await sleep(11000);
page = await (await fetch(`${B}/${pub}`)).text();
ok(page.includes('lt-page lt-regular'), 'site default font reaches public pages');
ok((await api('/api/session')).status === 200, 'login still valid at epoch 0');
r = await fetch(`${B}/api/reset-access`, { method: 'POST', headers: H, body: '{}' });
ok(r.status === 200 && /Max-Age=0/.test(r.headers.get('set-cookie') || ''), 'sign out everywhere saved');
fs.writeFileSync(deployed, JSON.stringify({ v: 1, font: 'regular', epoch: 1 }));
await sleep(11000);
ok((await api('/api/session')).status === 401, 'old login refused after the deploy');
ok((await rpc('tools/list', {})).error === 'invalid_token', 'old Claude token refused after the deploy');
const cookie2 = await login();
ok((await fetch(`${B}/api/session`, { headers: { Cookie: cookie2 } })).status === 200, 'a new login works');

fs.unlinkSync(deployed);
fs.unlinkSync(`${root}public/tags/${pub}.json`);
// Remove the labels this run made, so the stand-in stays tidy.
for (const slug of [a, rb, pub]) {
  await fetch(`${B}/api/tag/${slug}`, { method: 'DELETE', headers: { Cookie: cookie2, Origin: B, 'Content-Type': 'application/json' }, body: '{}' });
}
// Lockout: a burst of wrong guesses can't all get through.
const burst = await Promise.all(Array.from({ length: 8 }, () => fetch(`${B}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B, 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify({ password: 'wrong-guess-1234567' })
}).then((x) => x.status)));
ok(burst.filter((s) => s === 429).length >= 3, 'parallel wrong guesses hit the lockout', JSON.stringify(burst));
// IPv6 neighbours in the same /64 share the count.
const v6 = (ip) => fetch(`${B}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B, 'CF-Connecting-IP': ip }, body: JSON.stringify({ password: 'wrong-guess-1234567' }) }).then((x) => x.status);
for (let i = 1; i <= 5; i++) await v6(`2001:db8:1:2::${i}`);
ok((await v6('2001:db8:1:2:ffff::1')) === 429, 'IPv6 lockout covers the whole /64');
await control({ reset: true });
console.log(fails ? `\n${fails} of ${count} FAILED` : `\nALL ${count} PASSED`);
process.exit(fails ? 1 : 0);
