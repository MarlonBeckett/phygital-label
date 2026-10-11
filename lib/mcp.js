// The MCP server's tools: what Claude can do with labels. Kept apart from
// the HTTP handling in functions/mcp.js.

import { githubProblem, GitHubError } from './github.js';
import { listLabels, getLabel, saveLabel, removeLabel, LabelError } from './labels.js';
import { listFiles } from './files.js';
import { LIMITS, PRESETS, RESERVED } from '../public/assets/label.js';

export const SERVER_INFO = { name: 'phygital-label-maker', title: 'Phygital label maker', version: '1.0.0' };

export const INSTRUCTIONS = `This server makes "phygital labels": small web pages styled like embossed label-maker tape. Each label lives at https://<site>/<address>, and its owner writes that address onto an NFC sticker hidden under a physical label, so tapping the item with a phone opens the page.

Good labels are short and practical: a title naming the item, then links to its manual, support, how-to videos, warranty and so on, maybe a short note. Use menus (sub-pages) to group many links. Only use real links you know or the person gave you; if you don't have an address yet, leave "url" empty and the strip shows as "coming soon".

Before creating, check list_labels so you don't pick an address that is taken. After saving, the page goes live in about a minute; give the person the full URL and remind them to write it to their NFC sticker (Android: the label maker's "Write to tag" button; iPhone: the NFC Tools app).`;

const COLORS = PRESETS.map((p) => `${p.name} ${p.hex}`).join(', ');

const ADDRESS = {
  type: 'string',
  description: `The label's address: lowercase letters, numbers and dashes, up to ${LIMITS.slug} characters, e.g. "espresso-machine". It becomes https://<site>/<address>. Reserved: ${RESERVED.join(', ')}.`
};

const COLOR = { type: 'string', description: `Tape colour as #RRGGBB. Presets: ${COLORS}. Letters switch to dark on light tape automatically.` };

const BLOCK = {
  type: 'object',
  description: 'One block on a page.',
  properties: {
    type: {
      type: 'string',
      enum: ['link', 'text', 'video', 'menu', 'heading', 'file', 'files'],
      description: 'link: a tape strip opening a web address. text: a paper note. video: a YouTube video. menu: a strip that opens another page of this label. heading: a small strip naming a section. file: one of the owner\'s uploaded files (see list_files): images, video and audio show on the page, other files open from a strip. files: a file stack, uploaded files shown one at a time that visitors swipe through and open; with downloads:true it has a Download button, with uploads:true visitors can add their own (e.g. receipts under a service log).'
    },
    label: { type: 'string', description: `Words on the strip (link, menu, heading; up to ${LIMITS.label} characters), or the video's caption (up to ${LIMITS.videoTitle}). Keep strips short: 1-3 words read best.` },
    url: { type: 'string', description: 'link: an https:// or http:// address (empty = "coming soon"). video: a YouTube link (youtube.com/watch, youtu.be or Shorts).' },
    text: { type: 'string', description: `text blocks only: the note, up to ${LIMITS.text} characters. Line breaks are kept. Inline links: [words](https://example.com).` },
    editable: { type: 'boolean', description: `text blocks only: true lets anyone who taps the sticker edit this note without logging in (e.g. a service log or "last cleaned" note). Such notes show as plain text (no links) and can be up to ${LIMITS.editableText} characters. Only set it when the person asks.` },
    page: { type: 'string', description: 'menu blocks only: the slug of the page it opens. Must match a page in this label.' },
    file: { type: 'string', description: 'file blocks only: the "ref" of a file from list_files, like "abc123…/manual.pdf". Files can only be uploaded by the owner in the label maker. A file no label uses any more is deleted from the repo when a label is saved, so only take a file off a label if the person wants it gone.' },
    files: { type: 'array', items: { type: 'string' }, description: `files blocks only: refs of files from list_files, in order (at most ${LIMITS.stack}). Can start empty.` },
    uploads: { type: 'boolean', description: 'files blocks only: true lets anyone who taps the sticker add files to this stack without logging in. Only set it when the person asks.' },
    downloads: { type: 'boolean', description: 'files blocks only: true adds a Download button for the file in view.' },
    color: { ...COLOR, description: `Optional, for link, menu and heading: this strip's own colour (otherwise the page colour). ${COLOR.description}` }
  },
  required: ['type']
};

const LABEL = {
  type: 'object',
  description: 'The whole label: one main page plus optional sub-pages opened by menu blocks.',
  properties: {
    font: {
      type: 'string',
      enum: ['label', 'regular'],
      description: 'Leave out to follow the site\'s default text style (set by the owner). "label": notes and small text use the label-tape font too. "regular": a plain font for notes, easier to read for long text. Titles and strips are always label tape.'
    },
    pages: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.pages,
      description: 'The first page is the main page and must have slug "". Others are sub-pages with their own slug.',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Empty "" for the first (main) page. Sub-pages: lowercase letters, numbers and dashes, e.g. "settings".' },
          title: { type: 'string', description: `The big tape at the top, up to ${LIMITS.title} characters. Usually the item's name.` },
          color: COLOR,
          blocks: { type: 'array', maxItems: LIMITS.blocks, items: BLOCK }
        },
        required: ['slug', 'title', 'blocks']
      }
    }
  },
  required: ['pages']
};

const SHA = { type: 'string', description: 'Optional: the sha from get_label. If given, the change is refused when the label was edited elsewhere since.' };

export const TOOLS = [
  {
    name: 'list_labels',
    title: 'List labels',
    description: 'Lists every label on the site: address, title, colour, number of pages and URL.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'list_files',
    title: 'List uploaded files',
    description: 'Lists the files the owner uploaded in the label maker: name, size, type, and which labels use them. Put one on a label with a file block, using the file\'s ref.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'get_label',
    title: 'Get a label',
    description: 'Gets one label in full (all pages and blocks) plus its sha. Use it before updating a label.',
    inputSchema: { type: 'object', properties: { address: ADDRESS }, required: ['address'] },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'create_label',
    title: 'Create a label',
    description: 'Creates a new label page. Fails if the address is already used (use update_label for that). Goes live in about a minute.',
    inputSchema: { type: 'object', properties: { address: ADDRESS, label: LABEL }, required: ['address', 'label'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'update_label',
    title: 'Update a label',
    description: 'Replaces an existing label with a new version. Send the whole label (get_label first, change it, send it back), not just the changes.',
    inputSchema: { type: 'object', properties: { address: ADDRESS, label: LABEL, sha: SHA }, required: ['address', 'label'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'delete_label',
    title: 'Delete a label',
    description: 'Deletes a label and all the uploaded files on it (including files visitors added), even if another label shows them too. Its page stops working, so any NFC sticker pointing at it shows "Nothing here". Ask the person to confirm first.',
    inputSchema: { type: 'object', properties: { address: ADDRESS, sha: SHA }, required: ['address'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const str = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

// Runs a tool. Problems come back as tool errors Claude can read and fix.
export async function callTool(env, siteOrigin, name, args = {}) {
  if (!TOOLS.some((t) => t.name === name)) return text(`Unknown tool: ${name}`, true);
  const setup = githubProblem(env);
  if (setup) return text(`The site is not set up yet: ${setup}`, true);
  const urlOf = (slug) => `${siteOrigin}/${slug}`;
  const live = 'It goes live in about a minute. Write this address to the NFC sticker: on Android use "Write to tag" in the label maker, on iPhone use the NFC Tools app (Write > Add a record > URL).';
  try {
    if (name === 'list_labels') {
      const labels = await listLabels(env);
      if (!labels.length) return text('There are no labels yet.');
      const lines = labels.map((l) => `- /${l.slug}: ${l.title || '(no title)'} · ${l.color} · ${l.pages} page${l.pages === 1 ? '' : 's'}${l.problems ? ' · has problems' : ''} · ${urlOf(l.slug)}`);
      return text(`${labels.length} label${labels.length === 1 ? '' : 's'}:\n${lines.join('\n')}`);
    }
    if (name === 'list_files') {
      const files = await listFiles(env);
      if (!files.length) return text('No files uploaded yet. The owner can upload them in the label maker (Files tab).');
      const lines = files.map((f) => `- ${f.name} · ${f.kind} · ${Math.max(1, Math.round(f.size / 1024))} KB · ref ${f.ref}${f.usedBy.length ? ` · on ${f.usedBy.map((s) => `/${s}`).join(', ')}` : ''}`);
      return text(`${files.length} file${files.length === 1 ? '' : 's'}:\n${lines.join('\n')}`);
    }
    if (name === 'get_label') {
      const found = await getLabel(env, str(args.address));
      const out = { address: found.slug, url: urlOf(found.slug), sha: found.sha, label: found.tag };
      if (found.warnings.length) out.problems = found.warnings;
      return text(JSON.stringify(out, null, 2));
    }
    if (name === 'create_label') {
      const saved = await saveLabel(env, str(args.address), args.label);
      return text(`Created ${urlOf(saved.slug)} (sha ${saved.sha}). ${live}`);
    }
    if (name === 'update_label') {
      // Anything that isn't a real 40-character sha counts as no sha.
      const sha = typeof args.sha === 'string' && /^[0-9a-f]{40}$/.test(args.sha) ? args.sha : '';
      if (!sha) {
        // Visitors may have changed notes or added files since Claude read it.
        const current = await getLabel(env, str(args.address)).catch(() => null);
        const open = current && current.tag.pages.some((p) => p.blocks.some((b) => (b.type === 'text' && b.editable) || (b.type === 'files' && b.uploads)));
        if (open) return text('This label has notes or file stacks visitors can change. Call get_label first and pass its sha, so their changes are not overwritten.', true);
      }
      const saved = await saveLabel(env, str(args.address), args.label, { sha, overwrite: true, mustExist: true });
      return text(`Updated ${urlOf(saved.slug)} (sha ${saved.sha}). The change goes live in about a minute; the NFC sticker doesn't need rewriting.`);
    }
    if (name === 'delete_label') {
      const gone = await removeLabel(env, str(args.address));
      const also = gone.files.length ? ` Also deleted ${gone.files.length === 1 ? 'its file' : `its ${gone.files.length} files`}: ${gone.files.join(', ')}.` : '';
      return text(`Deleted /${gone.slug}. The page disappears in about a minute.${also}`);
    }
  } catch (e) {
    if (e instanceof LabelError) {
      const more = e.extra.errors && e.extra.errors.length > 1 ? `\n${e.extra.errors.map((x) => `- ${x}`).join('\n')}` : '';
      const hint = e.extra.exists ? ' Pick another address, or use update_label to replace it.' : e.extra.missing ? ' Check list_labels for the right address.' : '';
      return text(`${e.message}${hint}${more}`, true);
    }
    if (e instanceof GitHubError) return text(e.message, true);
    return text('Could not reach GitHub. Try again in a minute.', true);
  }
  return text(`Unknown tool: ${name}`, true);
}
