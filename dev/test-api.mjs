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
ok(j.result?.tools.length === 5, 'five tools');
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
