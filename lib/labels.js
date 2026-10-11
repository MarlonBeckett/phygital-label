// Label (tag) operations shared by the editor's API and the MCP server, so
// both check and save tags the same way.

import { slugProblem, validateTag, normColor, nextFreeSlug, DEFAULT_COLOR } from '../public/assets/label.js';
import { readTag, writeTag, deleteTag, listTags, githubProblem, GitHubError } from './github.js';
import { json } from './http.js';
import { requireSession } from './auth.js';

// For the label maker's API: the owner must be unlocked and GitHub set up.
// Returns a Response to send back, or null to continue.
export async function ownerGuard(request, env) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  const setup = githubProblem(env);
  if (setup) return json({ error: setup, setup: true }, 500);
  return null;
}

export class LabelError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function checkAddress(slug) {
  const problem = slugProblem(slug, { isTag: true });
  if (problem) throw new LabelError(400, `Address "${slug}": ${problem}`);
}

// Short summaries for the main menu and Claude's list.
export async function listLabels(env) {
  const files = await listTags(env);
  return files.map(({ slug, sha, tag }) => {
    const { ok, tag: clean } = validateTag(tag);
    const main = clean && clean.pages[0];
    return {
      slug,
      sha,
      title: (main && main.title) || '',
      color: (main && normColor(main.color)) || DEFAULT_COLOR,
      pages: clean ? clean.pages.length : 0,
      font: (clean && clean.font) || 'default',
      problems: !ok
    };
  });
}

export async function getLabel(env, slug) {
  checkAddress(slug);
  const found = await readTag(env, slug);
  if (!found) throw new LabelError(404, `There is no label at /${slug}.`, { missing: true });
  const { ok, errors, tag } = validateTag(found.tag);
  if (!tag || !tag.pages.length) throw new LabelError(422, `The file for /${slug} is broken (${errors[0] || 'unreadable'}). Fix or delete public/tags/${slug}.json on GitHub.`);
  return { slug, sha: found.sha, tag, warnings: ok ? [] : errors };
}

// Saves a tag. With no sha it creates one, and refuses to replace an existing
// tag unless `overwrite`. `mustExist` turns that around for updates.
export async function saveLabel(env, slug, input, { sha = '', overwrite = false, mustExist = false } = {}) {
  checkAddress(slug);
  const { ok, errors, tag } = validateTag(input);
  if (!ok) throw new LabelError(400, errors[0], { errors });
  if (!/^[0-9a-f]{40}$/.test(sha)) sha = '';
  if (!sha) {
    const existing = await readTag(env, slug);
    if (existing) {
      if (!overwrite) throw new LabelError(409, `A tag already exists at /${slug}.`, { exists: true });
      sha = existing.sha;
    } else if (mustExist) {
      throw new LabelError(404, `There is no label at /${slug}.`, { missing: true });
    }
  }
  const newSha = await writeTag(env, slug, tag, sha);
  return { slug, sha: newSha, tag };
}

// Saves a tag at an address that is already in use, moving the label that
// was there to the next free address ("camera-2") instead of losing it.
// Returns the save plus `movedTo` ('' if nothing was there).
export async function replaceLabel(env, slug, input) {
  checkAddress(slug);
  const { ok, errors, tag } = validateTag(input);
  if (!ok) throw new LabelError(400, errors[0], { errors });
  const existing = await readTag(env, slug);
  if (!existing) return { ...(await saveLabel(env, slug, tag)), movedTo: '' };
  const taken = new Set((await listTags(env)).map((t) => t.slug));
  const movedTo = nextFreeSlug(slug, taken);
  if (!movedTo) throw new LabelError(409, `Could not find a free address to move /${slug} to.`);
  // Copy the old label first, so a failure never loses it.
  const copySha = await writeTag(env, movedTo, existing.tag, '', `Move tag ${slug} to ${movedTo}`);
  try {
    const sha = await writeTag(env, slug, tag, existing.sha);
    return { slug, sha, tag, movedTo };
  } catch (e) {
    // GitHub clearly refused the write (4xx): nothing changed at /slug, so
    // remove the copy to keep retries tidy. Anything else (timeout, 5xx)
    // might have gone through, so the copy is kept: it may be the only one.
    const refused = e instanceof GitHubError && e.status >= 400 && e.status < 500;
    if (refused) {
      try { if (copySha) await deleteTag(env, movedTo, copySha); } catch (e2) { /* the copy stays; nothing is lost */ }
      throw e;
    }
    throw new LabelError(502, `Couldn't confirm the replace. The old label is safe at /${movedTo}; open /${slug} to check which version it has.`, { movedTo });
  }
}

export async function removeLabel(env, slug, sha = '') {
  checkAddress(slug);
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    const existing = await readTag(env, slug);
    if (!existing) throw new LabelError(404, `There is no label at /${slug}.`, { missing: true });
    sha = existing.sha;
  }
  if (!(await deleteTag(env, slug, sha))) throw new LabelError(404, `There is no label at /${slug}.`, { missing: true });
  return { slug };
}

// Turns a LabelError or GitHubError into the API's JSON error response.
export function errorResponse(e) {
  if (e instanceof LabelError) return json({ error: e.message, ...e.extra }, e.status);
  // `github` tells the label maker which GitHub problem it was (401 = the token expired).
  if (e instanceof GitHubError) return json({ error: e.message, github: e.status }, e.status === 409 || e.status === 422 ? 409 : 502);
  return json({ error: 'Could not reach GitHub. Try again in a minute.' }, 502);
}
