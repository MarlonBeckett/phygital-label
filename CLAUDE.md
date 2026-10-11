# Notes for Claude

Phygital label maker: embossed-label NFC tag pages on Cloudflare Pages. The
owner does not code: explain steps in plain language.

## Hard rules
- Plain HTML, CSS and vanilla JS. No frameworks, no npm dependencies, no build
  step, no database. Nothing that needs updating over time.
- Never use the DYMO name or logo; call the style "embossed label".
- No public page may list all tags (the main menu at /new lists them only
  after unlocking). Keep noindex meta, X-Robots-Tag and robots.txt.
- Escape all user content; only http/https links and YouTube video URLs.
- `GITHUB_TOKEN` / `GITHUB_REPO` / `ADMIN_PASSWORD` stay server-side.
- The public template must contain no personal info and exactly one fake
  example tag (`public/tags/example.json`).
- Don't use the browser's `confirm()` / `alert()`: some in-app browsers block
  them silently. Use `ask()` / `choose()` / `tell()` in `editor.js`.

## Where things are
- `public/assets/label.js` – the one renderer for tape strips (emboss jitter,
  tilt, ink colour, auto-fit, long labels split into stacked tapes,
  `[text](url)` links) plus tag validation. Used by the server pages AND the
  editor's live preview, so visual changes to blocks go here and in
  `public/assets/label.css`.
- `public/new.html`, `public/assets/editor.{js,css}` – the label maker: unlock,
  main menu (Labels / Settings tabs), editor, saved screen, in-app dialogs.
- `lib/page.js` – HTML shell for `/<tag>` and `/<tag>/<page>`.
- `lib/labels.js` – list / get / save / replace / delete, shared by the API
  and the MCP server. `lib/github.js` – GitHub Contents + GraphQL calls.
- `lib/settings.js` + `functions/_middleware.js` – site settings in
  `public/tags/_settings.json` (default text style, sign-in `epoch`). The live
  site reads the deployed copy; Settings writes it through GitHub.
- `lib/mcp.js`, `functions/mcp.js` – the Claude connector at `/mcp` (tools:
  list/get/create/update/delete labels).
- `lib/oauth.js`, `functions/oauth/*`, `functions/.well-known/*` – OAuth 2.1
  sign-in for Claude. Stateless: client ids, codes and tokens are HMAC-signed
  with ADMIN_PASSWORD plus the settings `epoch` ("Sign out everywhere" bumps
  it, which also invalidates login cookies).
- `functions/api/*` – the label maker's API (session-protected).

## Text style
A tag's `font` is `"label"`, `"regular"`, or absent (= the site default from
Settings). In the editor it's one switch: off follows the site default, on
uses the other font.

## Maintenance
The only thing that wears out is the GitHub token (fine-grained tokens expire,
often after a year). Tag pages keep working without it; only saving breaks.
The main menu warns 14 days ahead and shows the fix steps once it expires.

## Run locally
Needs Node.js. From the repo root:

    npx wrangler pages dev public

Then open http://localhost:8788/example and http://localhost:8788/new.
For /new, create a `.dev.vars` file (git-ignored) with ADMIN_PASSWORD (16+
chars), GITHUB_TOKEN and GITHUB_REPO. Saving with a real token commits to
that repo, so point GITHUB_REPO at a test repo while experimenting.
`GITHUB_API` can point the server at a local stand-in for the GitHub API.

## Design reference
Approved mockups are 390px phone screens: warm grey board #E4E2DC with dot
texture, preset tapes black #161616, red #AD161C, blue #1B4A9E, green
#17633A, yellow #E9B819, orange #D9601A, purple #5B2A86; label font Impact
Label Reversed with fallback Anton; UI fonts Archivo and IBM Plex Mono
(all self-hosted in `public/fonts`). Touch targets at least 44px. Buttons
that matter are tape strips (green + New label, orange Connect to Claude).
