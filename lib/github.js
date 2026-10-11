// Reads and writes tag files in the GitHub repo through the Contents API.
// The token stays on the server; it is never sent to the browser.

const API = 'https://api.github.com';

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
  return `${API}/repos/${env.GITHUB_REPO.trim()}/contents/${tagPath(slug)}`;
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
  if (status === 401) return 'GitHub did not accept GITHUB_TOKEN. It may have expired or been copied wrong. Make a new token and update it in Cloudflare.';
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
    const repo = await fetch(`${API}/repos/${env.GITHUB_REPO.trim()}`, { headers: headers(env) });
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
export async function writeTag(env, slug, tag, sha) {
  const body = {
    message: `${sha ? 'Update' : 'Add'} tag ${slug}`,
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
