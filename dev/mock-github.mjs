// A stand-in for the bits of the GitHub API the site uses, for local testing.
// In memory only: it starts from the label files in the folder you give it
// and forgets everything when stopped. No dependencies.
//
//   node dev/mock-github.mjs public/tags
//
// Then point the site at it in .dev.vars:
//   GITHUB_TOKEN=local-mock
//   GITHUB_REPO=local/mock
//   GITHUB_API=http://localhost:8790
//
// Environment: EXPIRES_DAYS=10 (token expiry it reports), TOKEN_EXPIRED=1
// (answer every request with 401, like an expired token).
// Tests can steer it with POST /__control (see dev/test-api.mjs).
// failPut entries are file names in public/tags (500, not applied) or { name, status }.

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const dir = process.argv[2] || 'public/tags';
const PORT = Number(process.env.PORT || 8790);
const files = new Map(); // repo path → { bytes: Buffer, sha }
const blobs = new Map(); // blob sha → bytes (for the Git Data API)
const sha = (bytes) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
const store = (path, bytes) => { const s = sha(bytes); blobs.set(s, bytes); files.set(path, { bytes, sha: s }); };
// Git Data API stand-in: trees and commits are just recorded changes.
let head = crypto.randomBytes(20).toString('hex');
const trees = new Map();   // tree sha → [{ path, sha }]
const gitCommits = new Map(); // commit sha → { tree, message, parent }
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.json')) store(`public/tags/${f}`, fs.readFileSync(`${dir}/${f}`));
}

let control = { expired: !!process.env.TOKEN_EXPIRED, failPut: new Map() };
const commits = []; // { message, date }, newest last

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

// Children of a folder: [{ name, path, isDir }]
function children(folder) {
  const out = new Map();
  for (const path of files.keys()) {
    if (!path.startsWith(`${folder}/`)) continue;
    const rest = path.slice(folder.length + 1);
    const name = rest.split('/')[0];
    out.set(name, { name, path: `${folder}/${name}`, isDir: rest.includes('/') });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function tree(folder, depth) {
  const list = children(folder);
  if (!list.length) return null;
  return {
    entries: list.map((c) => c.isDir
      ? { name: c.name, oid: '', object: depth > 1 ? tree(c.path, depth - 1) : {} }
      : { name: c.name, oid: files.get(c.path).sha, object: { text: files.get(c.path).bytes.toString('utf8'), byteSize: files.get(c.path).bytes.length } })
  };
}

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const body = raw ? JSON.parse(raw) : {};

  // Test hooks: { expired, hidden, failPut: [...], put: { name, text }, remove: name, reset }
  if (req.url === '/__control') {
    if (body.reset) control = { expired: false, failPut: new Map() };
    if ('expired' in body) control.expired = !!body.expired;
    if ('hidden' in body) control.hidden = !!body.hidden; // the token can't see the repo
    if (body.failPut) body.failPut.forEach((f) => (typeof f === 'string' ? control.failPut.set(f, 500) : control.failPut.set(f.name, f.status)));
    if (body.put) store(`public/tags/${body.put.name}`, Buffer.from(body.put.text));
    if (body.remove) files.delete(`public/tags/${body.remove}`);
    if (body.fakeCommits) for (let i = 0; i < body.fakeCommits.count; i++) commits.push({ message: body.fakeCommits.message, date: new Date().toISOString() });
    if (body.clearCommits) commits.length = 0;
    if ('failMove' in body) control.failMove = !!body.failMove;
    return send(res, 200, { ok: true, files: [...files.keys()] });
  }

  if (control.expired) return send(res, 401, { message: 'Bad credentials' });
  if (control.hidden) {
    if (req.url === '/graphql') return send(res, 200, { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] });
    return send(res, 404, { message: 'Not Found' });
  }

  if (req.url === '/graphql') {
    if (body.query.includes('pub:')) {
      return send(res, 200, { data: { repository: { pub: tree('public/files', 2), priv: tree('files', 2) } } });
    }
    return send(res, 200, { data: { repository: { object: tree('public/tags', 1) || { entries: [] } } } });
  }
  const git = req.url.match(/^\/repos\/[^/]+\/[^/]+\/git\/(.+)$/);
  if (git) {
    const [what, ...rest] = git[1].split('/');
    if (what === 'ref' && req.method === 'GET') return send(res, 200, { object: { sha: head } });
    if (what === 'commits' && req.method === 'GET') return send(res, 200, { sha: rest[0], tree: { sha: `tree-of-${rest[0]}` } });
    if (what === 'trees' && req.method === 'POST') {
      const id = crypto.randomBytes(20).toString('hex');
      trees.set(id, body.tree || []);
      return send(res, 201, { sha: id });
    }
    if (what === 'commits' && req.method === 'POST') {
      const id = crypto.randomBytes(20).toString('hex');
      gitCommits.set(id, { tree: body.tree, message: body.message, parent: (body.parents || [])[0] });
      return send(res, 201, { sha: id });
    }
    if (what === 'refs' && req.method === 'PATCH') {
      const c = gitCommits.get(body.sha);
      if (!c || c.parent !== head) return send(res, 422, { message: 'Update is not a fast forward' });
      if (control.failMove) { control.failMove = false; return send(res, 500, { message: 'Simulated failure' }); }
      for (const e of trees.get(c.tree) || []) {
        if (e.sha === null) files.delete(e.path);
        else if (blobs.has(e.sha)) files.set(e.path, { bytes: blobs.get(e.sha), sha: e.sha });
        else return send(res, 422, { message: 'unknown blob' });
      }
      head = body.sha;
      commits.push({ message: c.message, date: new Date().toISOString() });
      return send(res, 200, { object: { sha: head } });
    }
    return send(res, 404, { message: 'Not Found' });
  }
  if (/^\/repos\/[^/]+\/[^/]+$/.test(req.url)) {
    const days = Number(process.env.EXPIRES_DAYS || 10);
    const exp = new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    res.setHeader('github-authentication-token-expiration', exp);
    return send(res, 200, { full_name: 'local/mock', private: true, default_branch: 'main' });
  }
  const cm = req.url.match(/^\/repos\/[^/]+\/[^/]+\/commits\?(.*)$/);
  if (cm) {
    const since = new URLSearchParams(cm[1]).get('since') || '';
    const list = commits.filter((c) => c.date >= since).reverse().slice(0, 100).map((c) => ({ commit: { message: c.message } }));
    return send(res, 200, list);
  }
  const m = req.url.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
  if (!m) return send(res, 404, { message: 'Not Found' });
  const path = m[1].split('/').map(decodeURIComponent).join('/');
  const name = path.split('/').pop();
  const cur = files.get(path);
  if (req.method === 'GET') {
    if (!cur) return send(res, 404, { message: 'Not Found' });
    if ((req.headers.accept || '').includes('raw')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(cur.bytes);
    }
    return send(res, 200, { sha: cur.sha, size: cur.bytes.length, content: cur.bytes.length <= 1024 * 1024 ? cur.bytes.toString('base64') : '' });
  }
  if (req.method === 'PUT') {
    if (path.startsWith('public/tags/') && control.failPut.has(name)) {
      const status = control.failPut.get(name);
      control.failPut.delete(name);
      return send(res, status, { message: 'Simulated failure' });
    }
    if (cur && body.sha !== cur.sha) return send(res, cur && !body.sha ? 422 : 409, { message: 'sha mismatch' });
    if (!cur && body.sha) return send(res, 422, { message: 'no file' });
    store(path, Buffer.from(body.content, 'base64'));
    commits.push({ message: body.message || '', date: new Date().toISOString() });
    head = crypto.randomBytes(20).toString('hex'); // every save moves the branch on
    return send(res, cur ? 200 : 201, { content: { sha: files.get(path).sha } });
  }
  if (req.method === 'DELETE') {
    if (!cur) return send(res, 404, { message: 'Not Found' });
    if (body.sha !== cur.sha) return send(res, 409, { message: 'sha mismatch' });
    files.delete(path);
    commits.push({ message: body.message || '', date: new Date().toISOString() });
    head = crypto.randomBytes(20).toString('hex');
    return send(res, 200, {});
  }
  send(res, 405, {});
}).listen(PORT, () => console.log(`GitHub stand-in on http://localhost:${PORT}`));
