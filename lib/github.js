// Reads and writes tag files in the GitHub repo through the Contents API.
// The token stays on the server; it is never sent to the browser.

const API = 'https://api.github.com';
// GITHUB_API is only for local testing against a stand-in server.
const api = (env) => (env.GITHUB_API || API).replace(/\/+$/, '');

export function tagPath(slug) {
  return `public/tags/${slug}.json`;
}

export function githubProblem(env) {
  if (!env.GITHUB_TOKEN) return 'GITHUB_TOKEN is not set. Add it in Cloudflare (Settings > Variables and Secrets), then redeploy.';
  if (!env.GITHUB_REPO) return 'GITHUB_REPO is not set. Add it in Cloudflare, for example your-name/my-tags, then redeploy.';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPO.trim())) {
    return 'GITHUB_REPO should look like your-name/my-tags (no https://github.com/ in front).';
  }
  return '';
}

function headers(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN.trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'embossed-label-tags'
  };
}

function url(env, slug) {
  return `${api(env)}/repos/${env.GITHUB_REPO.trim()}/contents/${tagPath(slug)}`;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function explain(status) {
  if (status === 401) return 'GitHub did not accept GITHUB_TOKEN: it may have expired, been regenerated or deleted, or been pasted wrong. Labels and stickers still work; only making and changing labels is blocked. To fix it: make a new fine-grained token on GitHub (only this repo, Contents: Read and write), then in Cloudflare open the Pages project › Settings › Variables and Secrets, replace GITHUB_TOKEN, and retry the latest deployment.';
  if (status === 403) return 'GitHub refused access. Check the token has "Contents: Read and write" on this repo.';
  if (status === 404) return 'GitHub could not find the repo. Check GITHUB_REPO and that the token can see that repo.';
  if (status === 409 || status === 422) return 'This tag was changed somewhere else since you opened it. Open it again, then redo your edit.';
  return `GitHub returned an error (${status}). Try again in a minute.`;
}

// Returns { tag, sha } or null when the file does not exist.
export async function readTag(env, slug) {
  const res = await fetch(url(env, slug), { headers: headers(env) });
  if (res.status === 404) {
    // Tell "no such tag" apart from "no such repo".
    const repo = await fetch(`${api(env)}/repos/${env.GITHUB_REPO.trim()}`, { headers: headers(env) });
    if (repo.ok) return null;
    throw new GitHubError(repo.status, explain(repo.status));
  }
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  const data = await res.json();
  let tag;
  try {
    tag = JSON.parse(fromBase64(data.content));
  } catch (e) {
    throw new GitHubError(500, `The file ${tagPath(slug)} is not valid JSON. Fix or delete it on GitHub.`);
  }
  return { tag, sha: data.sha };
}

// Creates or updates the file. Pass the sha you loaded to update; GitHub
// rejects the write if the file changed since. Returns the new sha.
export async function writeTag(env, slug, tag, sha, message = '') {
  const body = {
    message: message || `${sha ? 'Update' : 'Add'} tag ${slug}`,
    content: toBase64(JSON.stringify(tag, null, 2) + '\n')
  };
  if (sha) body.sha = sha;
  const res = await fetch(url(env, slug), {
    method: 'PUT',
    headers: { ...headers(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  const data = await res.json();
  return data.content && data.content.sha;
}

// Deletes the file. GitHub rejects it if the file changed since `sha`.
export async function deleteTag(env, slug, sha) {
  const res = await fetch(url(env, slug), {
    method: 'DELETE',
    headers: { ...headers(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Delete tag ${slug}`, sha })
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  return true;
}

// Every tag file with its contents, in one GraphQL request (a request per
// file would hit Cloudflare's subrequest limit). Returns [{ slug, sha, tag }],
// where tag is null if the file is not valid JSON.
export async function listTags(env) {
  const [owner, name] = env.GITHUB_REPO.trim().split('/');
  const query = `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: "HEAD:public/tags") {
        ... on Tree { entries { name oid object { ... on Blob { text } } } }
      }
    }
  }`;
  const res = await fetch(`${api(env)}/graphql`, {
    method: 'POST',
    headers: { ...headers(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { owner, name } })
  });
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  const data = await res.json();
  if (data.errors && data.errors.length) {
    if (data.errors[0].type === 'NOT_FOUND') throw new GitHubError(404, explain(404));
    throw new GitHubError(502, `GitHub returned an error: ${data.errors[0].message}`);
  }
  const repo = data.data && data.data.repository;
  if (!repo) throw new GitHubError(404, explain(404));
  const entries = (repo.object && repo.object.entries) || [];
  return entries
    .filter((e) => /^[a-z0-9-]+\.json$/.test(e.name))
    .map((e) => {
      let tag = null;
      try { tag = JSON.parse((e.object && e.object.text) || ''); } catch (err) { /* shown as broken */ }
      return { slug: e.name.slice(0, -5), sha: e.oid, tag };
    });
}

// Reads GitHub's expiry header: "2026-11-08 18:00:00 UTC", or with an offset
// like "-0800" / "+05:30". Returns a Date, or null if it can't be read.
export function parseGitHubDate(raw) {
  const m = String(raw).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(UTC|GMT|Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  let zone = (m[3] || 'Z').toUpperCase();
  if (zone === 'UTC' || zone === 'GMT') zone = 'Z';
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const d = new Date(`${m[1]}T${m[2]}${zone}`);
  return isNaN(d) ? null : d;
}

// Checks the token can reach the repo, and when the token expires. GitHub
// sends the expiry with every response for tokens that have one.
// Returns { repo, private, expires }: expires is an ISO date, '' for a token
// that never expires, or 'unknown' if GitHub's date couldn't be read.
export async function tokenStatus(env) {
  const res = await fetch(`${api(env)}/repos/${env.GITHUB_REPO.trim()}`, { headers: headers(env) });
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  const data = await res.json();
  const raw = res.headers.get('github-authentication-token-expiration') || '';
  const when = raw ? parseGitHubDate(raw) : null;
  return {
    repo: data.full_name || env.GITHUB_REPO.trim(),
    private: !!data.private,
    expires: !raw ? '' : when ? when.toISOString() : 'unknown'
  };
}

// ---- Any file in the repo (uploads) ----

function contentsUrl(env, path) {
  return `${api(env)}/repos/${env.GITHUB_REPO.trim()}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

// Creates a file from base64 text that streams straight from the browser to
// GitHub: the Worker never decodes or re-encodes it, which keeps it within
// the free plan's few milliseconds of CPU even for a 10 MB file.
// `base64` is a ReadableStream of exactly `length` bytes of base64 text.
// Returns the new file's sha.
export async function putFileStream(env, path, base64, length, message) {
  const enc = new TextEncoder();
  const head = enc.encode(`{"message":${JSON.stringify(message)},"content":"`);
  const tail = enc.encode('"}');
  const { readable, writable } = new FixedLengthStream(head.length + length + tail.length);
  const pump = (async () => {
    const out = writable.getWriter();
    await out.write(head);
    const reader = base64.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await out.write(value);
    }
    await out.write(tail);
    await out.close();
  })();
  const [res] = await Promise.all([
    fetch(contentsUrl(env, path), {
      method: 'PUT',
      headers: { ...headers(env), 'Content-Type': 'application/json' },
      body: readable
    }),
    pump
  ]);
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  const data = await res.json();
  return data.content && data.content.sha;
}

// ---- Several changes in one commit (Git Data API) ----

async function gitCall(env, path, opts = {}) {
  const res = await fetch(`${api(env)}/repos/${env.GITHUB_REPO.trim()}${path}`, {
    ...opts,
    headers: { ...headers(env), 'Content-Type': 'application/json' }
  });
  if (res.status === 409 || res.status === 422) {
    throw new GitHubError(res.status, 'Something else was saved at the same moment. Try again.');
  }
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  return res.json();
}

const branchPath = (branch) => branch.split('/').map(encodeURIComponent).join('/');

// The default branch's latest commit: { branch, sha, tree }.
export async function getHead(env) {
  const info = await gitCall(env, '');
  const branch = info.default_branch || 'main';
  const ref = await gitCall(env, `/git/ref/heads/${branchPath(branch)}`);
  const commit = await gitCall(env, `/git/commits/${ref.object.sha}`);
  return { branch, sha: ref.object.sha, tree: commit.tree.sha };
}

// Stores file content (base64 text streamed from the browser, as in
// putFileStream) without committing it yet. Returns the blob sha.
export async function createBlobStream(env, base64, length) {
  const enc = new TextEncoder();
  const head = enc.encode('{"encoding":"base64","content":"');
  const tail = enc.encode('"}');
  const { readable, writable } = new FixedLengthStream(head.length + length + tail.length);
  const pump = (async () => {
    const out = writable.getWriter();
    await out.write(head);
    const reader = base64.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await out.write(value);
    }
    await out.write(tail);
    await out.close();
  })();
  const [res] = await Promise.all([
    fetch(`${api(env)}/repos/${env.GITHUB_REPO.trim()}/git/blobs`, {
      method: 'POST',
      headers: { ...headers(env), 'Content-Type': 'application/json' },
      body: readable
    }),
    pump
  ]);
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  return (await res.json()).sha;
}

// Commits several changes at once on top of `head` (from getHead). Each
// change is { path, sha } (an existing blob), { path, content } (text), or
// { path, sha: null } (delete). The branch only moves if nothing else was
// committed since `head` (otherwise a GitHubError 409/422), so nothing is
// ever overwritten.
export async function commitChanges(env, head, changes, message) {
  const tree = await gitCall(env, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: head.tree,
      tree: changes.map((c) => ('content' in c
        ? { path: c.path, mode: '100644', type: 'blob', content: c.content }
        : { path: c.path, mode: '100644', type: 'blob', sha: c.sha }))
    })
  });
  const commit = await gitCall(env, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [head.sha] })
  });
  await gitCall(env, `/git/refs/heads/${branchPath(head.branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha })
  });
  return commit.sha;
}

// Moves a file to a new path in one commit, by pointing the new path at the
// same stored content (no file data passes through here) and removing the
// old path. `blobSha` is the file's sha.
export async function moveFile(env, from, to, blobSha, message) {
  const head = await getHead(env);
  await commitChanges(env, head, [{ path: to, sha: blobSha }, { path: from, sha: null }], message);
}

// A label exactly as it was at a commit (so a change can be built on it and
// committed on top of that same commit). Returns the parsed tag or null.
export async function readTagAt(env, slug, commitSha) {
  const res = await fetch(`${contentsUrl(env, tagPath(slug))}?ref=${encodeURIComponent(commitSha)}`, { headers: headers(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  const data = await res.json();
  try {
    return JSON.parse(fromBase64(data.content));
  } catch (e) {
    return null;
  }
}

// The file's sha, or '' if it doesn't exist.
export async function fileSha(env, path) {
  const res = await fetch(contentsUrl(env, path), { headers: { ...headers(env), Accept: 'application/vnd.github.object+json' } });
  if (res.status === 404) return '';
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  const data = await res.json();
  return data.sha || '';
}

// The raw file as a fetch Response (body streams), or null if missing.
export async function getRawFile(env, path) {
  const res = await fetch(contentsUrl(env, path), { headers: { ...headers(env), Accept: 'application/vnd.github.raw+json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  return res;
}

export async function deleteFile(env, path, sha, message) {
  const res = await fetch(contentsUrl(env, path), {
    method: 'DELETE',
    headers: { ...headers(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha })
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  return true;
}

// Every uploaded file, public and private, in one GraphQL request. Uploads
// live one per folder: public/files/<id>/<name> and files/<id>/<name>.
// Returns [{ id, name, size, private }].
export async function listUploads(env) {
  const [owner, name] = env.GITHUB_REPO.trim().split('/');
  const folder = `... on Tree { entries { name object { ... on Tree { entries { name object { ... on Blob { byteSize } } } } } } }`;
  const query = `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      pub: object(expression: "HEAD:public/files") { ${folder} }
      priv: object(expression: "HEAD:files") { ${folder} }
    }
  }`;
  const res = await fetch(`${api(env)}/graphql`, {
    method: 'POST',
    headers: { ...headers(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { owner, name } })
  });
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  const data = await res.json();
  if (data.errors && data.errors.length) {
    if (data.errors[0].type === 'NOT_FOUND') throw new GitHubError(404, explain(404));
    throw new GitHubError(502, `GitHub returned an error: ${data.errors[0].message}`);
  }
  const repo = data.data && data.data.repository;
  if (!repo) throw new GitHubError(404, explain(404));
  const out = [];
  for (const [key, isPrivate] of [['pub', false], ['priv', true]]) {
    for (const dir of (repo[key] && repo[key].entries) || []) {
      for (const f of (dir.object && dir.object.entries) || []) {
        out.push({ id: dir.name, name: f.name, size: (f.object && f.object.byteSize) || 0, private: isPrivate });
      }
    }
  }
  return out;
}

// Commit messages since a time (newest first, up to 100). Used to count
// visitor edits per day without any other storage.
export async function recentCommitMessages(env, since) {
  const res = await fetch(`${api(env)}/repos/${env.GITHUB_REPO.trim()}/commits?since=${encodeURIComponent(since)}&per_page=100`, { headers: headers(env) });
  if (!res.ok) throw new GitHubError(res.status, explain(res.status));
  const list = await res.json();
  return Array.isArray(list) ? list.map((c) => (c.commit && c.commit.message) || '') : [];
}
