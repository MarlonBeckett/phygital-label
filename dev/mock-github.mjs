// A stand-in for the bits of the GitHub API the site uses, for local testing.
// In memory only: it starts from the files in the folder you give it and
// forgets everything when stopped. No dependencies.
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
// failPut entries are file names (500, not applied) or { name, status }.

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const dir = process.argv[2] || 'public/tags';
const PORT = Number(process.env.PORT || 8790);
const files = new Map();
const sha = (text) => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.json')) {
    const t = fs.readFileSync(`${dir}/${f}`, 'utf8');
    files.set(f, { text: t, sha: sha(t) });
  }
}

let control = { expired: !!process.env.TOKEN_EXPIRED, failPut: new Map() };

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};

  // Test hooks: { expired: bool, failPut: ["name.json"], put: { name, text }, reset: true }
  if (req.url === '/__control') {
    if (body.reset) control = { expired: false, failPut: new Map() };
    if ('expired' in body) control.expired = !!body.expired;
    if ('hidden' in body) control.hidden = !!body.hidden; // the token can't see the repo
    if (body.failPut) body.failPut.forEach((f) => (typeof f === 'string' ? control.failPut.set(f, 500) : control.failPut.set(f.name, f.status)));
    if (body.put) files.set(body.put.name, { text: body.put.text, sha: sha(body.put.text) });
    if (body.remove) files.delete(body.remove);
    return send(res, 200, { ok: true, files: [...files.keys()] });
  }

  if (control.expired) return send(res, 401, { message: 'Bad credentials' });
  if (control.hidden) {
    if (req.url === '/graphql') return send(res, 200, { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] });
    return send(res, 404, { message: 'Not Found' });
  }

  if (req.url === '/graphql') {
    const entries = [...files].sort().map(([name, f]) => ({ name, oid: f.sha, object: { text: f.text } }));
    return send(res, 200, { data: { repository: { object: { entries } } } });
  }
  if (/^\/repos\/[^/]+\/[^/]+$/.test(req.url)) {
    const days = Number(process.env.EXPIRES_DAYS || 10);
    const exp = new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    res.setHeader('github-authentication-token-expiration', exp);
    return send(res, 200, { full_name: 'local/mock', private: true });
  }
  const m = req.url.match(/^\/repos\/[^/]+\/[^/]+\/contents\/public\/tags\/([_a-z0-9-]+\.json)$/);
  if (!m) return send(res, 404, { message: 'Not Found' });
  const name = m[1];
  const cur = files.get(name);
  if (req.method === 'GET') {
    return cur ? send(res, 200, { sha: cur.sha, content: Buffer.from(cur.text).toString('base64') }) : send(res, 404, { message: 'Not Found' });
  }
  if (req.method === 'PUT') {
    if (control.failPut.has(name)) {
      const status = control.failPut.get(name);
      control.failPut.delete(name);
      return send(res, status, { message: 'Simulated failure' });
    }
    if (cur && body.sha !== cur.sha) return send(res, 409, { message: 'sha mismatch' });
    if (!cur && body.sha) return send(res, 422, { message: 'no file' });
    const text = Buffer.from(body.content, 'base64').toString('utf8');
    files.set(name, { text, sha: sha(text) });
    return send(res, cur ? 200 : 201, { content: { sha: files.get(name).sha } });
  }
  if (req.method === 'DELETE') {
    if (!cur) return send(res, 404, { message: 'Not Found' });
    if (body.sha !== cur.sha) return send(res, 409, { message: 'sha mismatch' });
    files.delete(name);
    return send(res, 200, {});
  }
  send(res, 405, {});
}).listen(PORT, () => console.log(`GitHub stand-in on http://localhost:${PORT}`));
