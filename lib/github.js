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
  if (status === 401) return 'GitHub did not accept GITHUB_TOKEN: it has probably expired. Labels and stickers still work; only making and changing labels is blocked. To fix it: make a new fine-grained token on GitHub (only this repo, Contents: Read and write), then in Cloudflare open the Pages project › Settings › Variables and Secrets, replace GITHUB_TOKEN, and retry the latest deployment.';
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
