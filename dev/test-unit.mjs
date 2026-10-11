// Unit tests for the pure logic. No server needed, no dependencies:
//   node dev/test-unit.mjs

import {
  esc, isHttpUrl, youtubeId, richTextHtml, validateTag, splitLines, nextFreeSlug,
  fontOf, renderPageHtml, backLinkHtml, safeFileName, fileKind, isFileRef, formatBytes, cleanVisitorText, canBePublic
} from '../public/assets/label.js';
import { parseGitHubDate } from '../lib/github.js';
import { redirectProblem, isClaudeRedirect, seal, unseal } from '../lib/oauth.js';
import { clientKey, passwordProblem } from '../lib/auth.js';

let fails = 0;
let count = 0;
function ok(cond, label, extra = '') {
  count++;
  if (!cond) { fails++; console.log(`FAIL  ${label}${extra ? '  ' + extra : ''}`); }
}
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const taken = (...a) => new Set(a);

// --- escaping and links
eq(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;', 'esc escapes HTML');
ok(isHttpUrl('https://example.com/a?b=1'), 'https link accepted');
ok(!isHttpUrl('javascript:alert(1)'), 'javascript: link rejected');
ok(!isHttpUrl('data:text/html,hi'), 'data: link rejected');
ok(!isHttpUrl('https://exa mple.com'), 'link with space rejected');
eq(youtubeId('https://youtu.be/aqz-KE-bpKQ'), 'aqz-KE-bpKQ', 'youtu.be id');
eq(youtubeId('https://www.youtube.com/shorts/aqz-KE-bpKQ'), 'aqz-KE-bpKQ', 'shorts id');
eq(youtubeId('https://evil.com/watch?v=aqz-KE-bpKQ'), '', 'non-YouTube video rejected');
ok(!richTextHtml('[x](javascript:alert(1))').includes('<a'), 'javascript: inline link not linked');
ok(richTextHtml('<img src=x onerror=alert(1)>').startsWith('&lt;img'), 'inline HTML escaped');
ok(richTextHtml('see [docs](https://example.com)').includes('<a href="https://example.com">docs</a>'), 'inline link rendered');

// --- validation
const good = { pages: [{ slug: '', title: 'Camera', blocks: [{ type: 'link', label: 'Manual', url: 'https://example.com' }] }] };
ok(validateTag(good).ok, 'valid tag passes');
ok(!('font' in validateTag(good).tag), 'no font stored = follows the site default');
eq(validateTag({ ...good, font: 'regular' }).tag.font, 'regular', 'font kept when chosen');
ok(!('font' in validateTag({ ...good, font: 'comic' }).tag), 'unknown font dropped');
ok(!validateTag({ pages: [{ slug: '', title: 'x', blocks: [{ type: 'link', label: 'y', url: 'javascript:1' }] }] }).ok, 'bad link fails validation');
eq(validateTag({}).tag, null, 'file without pages gives no tag');
eq(validateTag(null).tag, null, 'null file gives no tag');
ok(!validateTag({ pages: [{ slug: '', blocks: [{ type: 'menu', label: 'm', page: 'nope' }] }] }).ok, 'menu to a missing page fails');

// --- uploaded files
eq(safeFileName('My Manual (v2).PDF'), 'My-Manual-v2.pdf', 'file name cleaned, extension lower-cased');
eq(safeFileName('../../etc/passwd'), 'passwd', 'no folders in file names');
eq(safeFileName('Ünïcödé café.jpg'), 'Unicode-cafe.jpg', 'accents dropped');
eq(safeFileName('???.png'), 'file.png', 'nothing usable → "file"');
ok(safeFileName('a'.repeat(300) + '.pdf').length <= 100, 'file names capped at 100');
eq(fileKind('x.PNG'), 'image', 'image kind');
eq(fileKind('x.mp4'), 'video', 'video kind');
eq(fileKind('x.pdf'), 'pdf', 'pdf kind');
eq(fileKind('x.svg'), 'risky', 'svg is risky');
eq(fileKind('x.html'), 'risky', 'html is risky');
eq(fileKind('x.zip'), 'other', 'zip is other');
ok(isFileRef('abcdefghijklmnop/manual.pdf'), 'valid file ref');
ok(!isFileRef('abc/manual.pdf') && !isFileRef('abcdefghijklmnop/../x') && !isFileRef('abcdefghijklmnop/.htaccess'), 'bad file refs refused');
eq(formatBytes(2048), '2 KB', 'format KB');
eq(formatBytes(1536 * 1024), '1.5 MB', 'format MB');
{
  const tag = (blocks) => ({ pages: [{ slug: '', title: 'T', blocks }] });
  ok(validateTag(tag([{ type: 'file', label: 'Manual', file: 'abcdefghijklmnop/manual.pdf' }])).ok, 'file block valid');
  ok(!validateTag(tag([{ type: 'file', file: 'javascript:alert(1)' }])).ok, 'file block must be an upload');
  const page = (b) => renderPageHtml(tag([b]), tag([b]).pages[0]);
  ok(page({ type: 'file', label: 'Pic', file: 'abcdefghijklmnop/a.jpg' }).includes('<img src="/files/abcdefghijklmnop/a.jpg"'), 'image file shows inline');
  ok(page({ type: 'file', file: 'abcdefghijklmnop/a.mp4' }).includes('<video src="/files/abcdefghijklmnop/a.mp4"'), 'video file plays inline');
  ok(page({ type: 'file', label: 'Manual', file: 'abcdefghijklmnop/m.pdf' }).includes('href="/files/abcdefghijklmnop/m.pdf"'), 'other files open from a strip');
  ok(page({ type: 'file', label: 'Manual', file: '' }).includes('coming soon'), 'missing file shows as coming soon');
  const t = tag([{ type: 'file', file: 'abcdefghijklmnop/a.jpg' }]);
  ok(renderPageHtml(t, t.pages[0], { fileUrl: (r) => `/api/file/${r}` }).includes('src="/api/file/abcdefghijklmnop/a.jpg"'), 'editor preview can load files through the API');
}

ok(canBePublic('a.pdf') && canBePublic('a.jpg') && canBePublic('a.zip') && canBePublic('a.docx'), 'viewable and download types can be public');
ok(!canBePublic('a.html') && !canBePublic('a.svg') && !canBePublic('a.rss') && !canBePublic('a.xsd') && !canBePublic('a.es') && !canBePublic('noext'), 'web-page-like and unknown types are private-only');

// --- notes anyone can edit
{
  const tag = (b) => ({ pages: [{ slug: '', title: 'T', blocks: [b] }] });
  const note = { type: 'text', text: 'see [x](https://evil.example) <b>hi</b>', editable: true };
  const live = renderPageHtml(tag(note), tag(note).pages[0], { tagSlug: 'r1', visitorEdit: true });
  ok(!live.includes('<a href="https://evil.example"') && live.includes('[x](https://evil.example)'), 'editable notes never turn text into links');
  ok(live.includes('&lt;b&gt;hi&lt;/b&gt;'), 'editable notes are escaped');
  ok(live.includes('class="lt-edit-btn"') && live.includes('data-edit-tag="r1"'), 'live page gets an Edit button');
  const preview = renderPageHtml(tag(note), tag(note).pages[0], { tagSlug: 'r1' });
  ok(!preview.includes('lt-edit-btn') && preview.includes('Anyone can edit'), 'editor preview shows a badge instead');
  ok(validateTag(tag({ type: 'text', text: 'x'.repeat(1000), editable: true })).ok, 'editable note up to 1000');
  ok(!validateTag(tag({ type: 'text', text: 'x'.repeat(1001), editable: true })).ok, 'editable note over 1000 refused');
  ok(validateTag(tag({ type: 'text', text: 'x'.repeat(1500) })).ok, 'normal notes keep the 2000 limit');
  ok(!('editable' in validateTag(tag({ type: 'text', text: 'x', editable: 'yes' })).tag.pages[0].blocks[0]), 'editable must be true, not just truthy');
  eq(cleanVisitorText('a\r\nb  \n\n\n\n\nc\u202Ed\u0007'), 'a\nb\n\n\ncd', 'visitor text cleaned');
  eq(cleanVisitorText('a\u2028b\uFEFFc\u2060d\u061Ce\u00ADf\uE000g\tH 👍'), 'a\nbcdefg\tH 👍', 'invisible and direction characters removed, emoji kept');
  const family = '👨\u200D👩\u200D👧';
  const persian = 'می\u200Cخواهم';
  eq(cleanVisitorText(family + ' ' + persian), family + ' ' + persian, 'joined emoji and Persian words survive');
}

// --- fonts
eq(fontOf({}, 'regular'), 'regular', 'no choice follows site default');
eq(fontOf({ font: 'label' }, 'regular'), 'label', 'own choice wins');
eq(fontOf({}, undefined), 'label', 'default is label');

// --- rendering
const html = renderPageHtml({ pages: [{ slug: '', title: '<script>x</script>', blocks: [] }] }, { slug: '', title: '<script>x</script>', blocks: [] });
ok(!html.includes('<script>'), 'title is escaped in the page');
ok(backLinkHtml('cam', '"><b>').includes('&quot;&gt;&lt;b&gt;'), 'back link title escaped');

// --- long labels
eq(splitLines('Example camera', 14), ['Example camera'], 'short title stays on one line');
eq(splitLines('Phygital label maker', 14), ['Phygital', 'label maker'], 'long title splits');
eq(splitLines('How to clean the lens and sensor safely', 22), ['How to clean the lens', 'and sensor safely'], 'strip splits evenly');
eq(splitLines('', 14), [''], 'empty label');
eq(splitLines('Supercalifragilisticexpialidocious', 14).length, 1, 'one long word keeps one line');

// --- next free address
eq(nextFreeSlug('test', taken('test')), 'test-2', 'test → test-2');
eq(nextFreeSlug('test', taken('test', 'test-2')), 'test-3', 'skips taken -2');
eq(nextFreeSlug('test-2', taken('test', 'test-2')), 'test-3', 'numbered copy continues the series');
eq(nextFreeSlug('route-66', taken('route-66')), 'route-66-2', 'route-66 keeps its number');
eq(nextFreeSlug('iphone-15', taken('iphone-15', 'iphone-15-2')), 'iphone-15-3', 'iphone-15 keeps its number');
ok(nextFreeSlug('a'.repeat(40), taken()).length <= 40, 'stays within 40 characters');

// --- GitHub expiry dates
eq(parseGitHubDate('2026-11-08 18:00:00 UTC').toISOString(), '2026-11-08T18:00:00.000Z', 'UTC date');
eq(parseGitHubDate('2026-11-08 18:00:00 -0800').toISOString(), '2026-11-09T02:00:00.000Z', 'offset date');
eq(parseGitHubDate('2026-11-08 18:00:00 +05:30').toISOString(), '2026-11-08T12:30:00.000Z', 'offset with colon');
eq(parseGitHubDate('soon'), null, 'unreadable date');

// --- OAuth redirect rules
eq(redirectProblem('https://claude.ai/api/mcp/auth_callback'), '', 'Claude callback allowed');
eq(redirectProblem('http://localhost:3000/cb'), '', 'localhost allowed');
ok(redirectProblem('http://evil.example/cb'), 'plain http elsewhere rejected');
ok(redirectProblem('https://a;b.com/cb'), 'odd host name rejected (CSP injection)');
ok(redirectProblem('https://user:pw@claude.ai/cb'), 'user:password rejected');
ok(redirectProblem('https://claude.ai/cb#x'), 'fragment rejected');
ok(isClaudeRedirect('https://claude.ai/api/mcp/auth_callback'), 'claude.ai is Claude');
ok(!isClaudeRedirect('https://claude.ai.evil.example/cb'), 'look-alike is not Claude');

// --- password rules
eq(passwordProblem({ ADMIN_PASSWORD: 'ab' }), '', 'short passwords are allowed');
ok(passwordProblem({ ADMIN_PASSWORD: '' }), 'empty password is refused');
ok(passwordProblem({}), 'missing password is refused');

// --- lockout keys
const key = (ip) => clientKey({ headers: new Headers({ 'CF-Connecting-IP': ip }) });
eq(key('203.0.113.9'), '203.0.113.9', 'IPv4 is its own key');
eq(key('2001:db8:1:2::5'), key('2001:db8:1:2:ffff::1'), 'IPv6 neighbours share a /64 key');
ok(key('2001:db8:1:2::5') !== key('2001:db8:1:3::5'), 'different /64s differ');
eq(key('::ffff:1.2.3.4'), '1.2.3.4', 'IPv4-mapped address keyed by IPv4');
ok(key('::ffff:1.2.3.4') !== key('::ffff:1.2.3.5'), 'IPv4-mapped addresses stay separate');
eq(key('fe80::1%eth0'), key('fe80::2'), 'zone id ignored');
eq(key('::1'), '0:0:0:0::/64', 'loopback');
eq(key('1:2:3::4:5:6:7:8:9'), '1:2:3::4:5:6:7:8:9', 'malformed address does not crash');

// --- signed tokens
const env = { ADMIN_PASSWORD: 'unit-test-password-1234' };
const t = await seal(env, 'access', { x: 1 }, 60);
ok((await unseal(env, 'access', t))?.x === 1, 'token round-trips');
eq(await unseal(env, 'refresh', t), null, 'access token is not a refresh token');
eq(await unseal({ ADMIN_PASSWORD: 'another-password-12345' }, 'access', t), null, 'other password rejects token');
eq(await unseal(env, 'access', t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA')), null, 'tampered token rejected');
eq(await unseal(env, 'access', await seal(env, 'access', { x: 1 }, -10)), null, 'expired token rejected');

// --- settings never fall back to epoch 0 on a failed read
{
  const realNow = Date.now;
  let now = 1e12;
  Date.now = () => now;
  const s = await import('../lib/settings.js?fresh=' + Math.random());
  const req = { url: 'https://site.test/x' };
  const answer = (status, body) => ({ ASSETS: { fetch: async () => new Response(body === undefined ? '' : JSON.stringify(body), { status }) } });
  const broken = { ASSETS: { fetch: async () => { throw new Error('down'); } } };
  await s.loadSettings(req, broken);
  ok(!s.settingsReady(), 'not ready before any good read');
  await s.loadSettings(req, answer(200, { v: 1, font: 'regular', epoch: 2 }));
  ok(s.settingsReady() && s.currentSettings().epoch === 2, 'good read loads epoch 2');
  now += 60000;
  await s.loadSettings(req, broken);
  eq(s.currentSettings().epoch, 2, 'failed read keeps epoch 2');
  await s.loadSettings(req, answer(500));
  eq(s.currentSettings().epoch, 2, 'server error keeps epoch 2');
  await s.loadSettings(req, answer(200, '<html>'));
  eq(s.currentSettings().epoch, 2, 'garbage keeps epoch 2');
  await s.loadSettings(req, answer(404));
  eq(s.currentSettings().epoch, 0, 'no settings file means defaults');
  Date.now = realNow;
}

console.log(fails ? `\n${fails} of ${count} FAILED` : `\nALL ${count} PASSED`);
process.exit(fails ? 1 : 0);
