// The label maker's save and load logic (editor.js has no exports, so the
// functions are read out of the file). Run: node dev/test-editor.mjs

import fs from 'node:fs';
import { validateTag, normColor, DEFAULT_COLOR, LIMITS } from '../public/assets/label.js';
const src = fs.readFileSync(new URL('../public/assets/editor.js', import.meta.url), 'utf8');
const lines = src.split('\n');
const grab = (start) => { const i = lines.findIndex((l) => l.startsWith(start)); let j = i; if (start.startsWith('function')) while (lines[j] !== '}') j++; return lines.slice(i, j + 1).join('\n'); };
const code = [grab('const isStack'), grab('function toData'), grab('function fromData'), grab('function syncStacks')].join('\n');
let seq = 1; const newId = (p) => p + seq++;
const f = new Function('normColor', 'DEFAULT_COLOR', 'LIMITS', 'newId', code + '\nlet state; return { isStack, fromData, syncStacks, toData: (s) => { state = s; return toData(); } };');
const E = f(normColor, DEFAULT_COLOR, LIMITS, newId);
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); };
const R = 'abcdefghijklmnop/';
const tag = { pages: [{ slug: '', title: 'T', color: '#161616', blocks: [
  { type: 'file', label: 'Manual', file: R + 'm.pdf', color: '#AD161C' },
  { type: 'files', label: 'Receipts', files: [R + 'a.jpg', R + 'b.jpg'], uploads: true },
  { type: 'files', label: 'One', files: [R + 'c.jpg'], downloads: true },
  { type: 'file', label: 'Empty', file: '' }
] }] };
const s = E.fromData('x', tag, 'sha');
ok(s.pages[0].blocks.every((b) => b.type === 'file'), 'all load as File cards');
const back = E.toData(s).pages[0].blocks;
ok(JSON.stringify(back[0]) === JSON.stringify({ type: 'file', label: 'Manual', file: R + 'm.pdf', color: '#AD161C' }), 'single file round-trips: ' + JSON.stringify(back[0]));
ok(back[1].type === 'files' && back[1].files.length === 2 && back[1].uploads === true && !back[1].downloads && !back[1].color, 'stack round-trips');
ok(back[2].type === 'files' && back[2].downloads === true && back[2].files.length === 1, 'one file + download stays a viewer');
ok(back[3].type === 'file' && back[3].file === '', 'empty file stays a file');
s.pages[0].blocks[0].downloads = true;
const b0 = E.toData(s).pages[0].blocks[0];
ok(b0.type === 'files' && b0.downloads && b0.files[0] === R + 'm.pdf' && !b0.color, 'switching download on turns a file into a viewer');
s.pages[0].blocks[0].downloads = false; s.pages[0].blocks[0].files.push(R + 'n.pdf');
ok(E.toData(s).pages[0].blocks[0].type === 'files', 'second file turns it into a viewer');
ok(validateTag(E.toData(s)).ok, 'output validates');
// syncStacks matches visitor files back to the right block
const saved = E.toData(s); saved.pages[0].blocks[1].files.push(R + 'visitor.jpg');
E.syncStacks(s, saved);
ok(s.pages[0].blocks[1].files.includes(R + 'visitor.jpg') && !s.pages[0].blocks[0].files.includes(R + 'visitor.jpg'), 'sync puts visitor files on the right block');
ok(s.openedStackFiles.includes(R + 'visitor.jpg'), 'opened files updated');
console.log(fail ? `${fail} FAILED` : `ALL ${pass} PASSED`);
if (fail) process.exit(1);
