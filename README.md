# Embossed label tags

Little web pages for the things you own. Hide an NFC sticker under an embossed label-maker label; when someone taps it with a phone, they get a page made of label tape: links to the manual, a how-to video, notes, and menus.

- **Free to run** on Cloudflare Pages, with no database and nothing to update.
- **Make and edit tags from your phone** at `yoursite.pages.dev/new`, behind a password.
- **Or let Claude make them:** connect Claude once, then ask for a label in plain words.
- **Each tag is one small file** in your own private GitHub repo.
- Plain HTML, CSS and JavaScript. No frameworks, no build step, nothing to install.

```
yoursite.pages.dev/camera            ← a tag's main page
yoursite.pages.dev/camera/settings   ← a sub-page (a "menu" strip opens it)
yoursite.pages.dev/new               ← the phygital label maker (password protected)
yoursite.pages.dev                   ← opens the label maker too
yoursite.pages.dev/mcp               ← the Claude connector address
```

There is an example tag at `/example` so you can see what a page looks like.

---

## Set up your own (about 20 minutes, no coding)

You need a free **GitHub** account and a free **Cloudflare** account. Do the steps in order.

### 1. Make your own private copy

1. On this project's GitHub page, click the green **Use this template** button, then **Create a new repository**.
2. **Repository name:** anything, for example `my-tags`.
3. Choose **Private**. Your tags live here, and private means nobody can browse the list.
4. Click **Create repository**.

Remember the name shown at the top of your new repo, written like `your-name/my-tags`. You will need it in step 4.

### 2. Put it online with Cloudflare Pages

1. Log in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. In the left menu, open **Compute (Workers & Pages)** (it may just say **Workers & Pages**), then click **Create**.
3. **Don't** pick the big **Continue with GitHub** button: that makes a *Worker*, which can't run this site (you'd later see "Variables cannot be added to a Worker that only has static assets"). Instead, at the bottom of that screen, click the small **Continue to Pages** link ("Need to use the legacy Pages workflow?"). Then choose **Import an existing Git repository** (or **Connect to Git**).
4. Connect your GitHub account when asked. When GitHub asks which repositories Cloudflare may see, you can pick **Only select repositories** and choose `my-tags`.
5. Select `my-tags` and click **Begin setup**.
6. Fill in the settings:
   - **Project name:** this becomes your address, `project-name.pages.dev`. Pick something that doesn't give away personal details.
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** leave **empty**
   - **Build output directory:** `public`
7. Click **Save and Deploy**. After a minute your site is live at `https://project-name.pages.dev`. If the address ends in `.workers.dev` instead, you made a Worker by mistake: delete it and start this step again with **Continue to Pages**.

### 3. Create the GitHub key the phygital label maker uses to save

The phygital label maker saves your tags into your repo. To do that it needs a key (a "fine-grained token") that can only touch that one repo.

1. On GitHub, click your profile picture (top right), then **Settings**.
2. Scroll down the left menu and click **Developer settings**.
3. Click **Personal access tokens**, then **Fine-grained tokens**, then **Generate new token**.
4. Fill it in:
   - **Token name:** `phygital label maker`
   - **Expiration:** choose the longest option offered (pick **No expiration** if you see it). If you have to choose an end date, put a reminder in your calendar to make a new token before then.
   - **Repository access:** **Only select repositories**, then choose `my-tags`.
   - **Permissions → Repository permissions → Contents:** set to **Read and write**. ("Metadata: Read-only" is added automatically. That's fine.) Leave everything else alone.
5. Click **Generate token** and **copy the token right away**. It starts with `github_pat_`, and GitHub only shows it once.

### 4. Add the three settings to Cloudflare

1. In Cloudflare, open your Pages project, then **Settings**, then **Variables and Secrets**.
2. Click **Add**. For each of the three below, choose type **Secret**, enter the name exactly as written, paste the value, and save.

| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | A password for the phygital label maker. Any length works, but anyone who guesses it can change your labels, so a few random words is a good choice, for example `pickle-lantern-orbit`. |
| `GITHUB_TOKEN` | The `github_pat_…` token from step 3. |
| `GITHUB_REPO` | Your repo's name, like `your-name/my-tags` (no `https://github.com/`). |

3. Settings only apply to new deploys. Go to the **Deployments** tab, open the menu (⋯) on the latest deployment, and choose **Retry deployment**.

Secrets stay inside Cloudflare. They are never sent to anyone's browser.

### 5. The label font

The label font is **Impact Label Reversed** by Tension Type (Michael Tension), at `public/fonts/ImpactLabelReversed.ttf`. It's a free font, but its terms vary between download sites: some say personal use only, with a donation asked for commercial use. If that matters for your use, either:

- keep it and support the author: [fontspace.com/impact-label-font-f9163](https://www.fontspace.com/impact-label-font-f9163), or
- delete the file from your repo on GitHub (open the file → ⋯ → **Delete file**). The pages then use the similar open-licence font **Anton** automatically.

To swap in a fresh copy: download the font, then on GitHub open the `public/fonts` folder, click **Add file → Upload files**, and upload it named exactly `ImpactLabelReversed.ttf`.

### 6. Make your first tag

1. On your phone, open `https://project-name.pages.dev/new`.
2. Enter your `ADMIN_PASSWORD` and tap **Unlock**. The phone stays unlocked for 30 days, and opens on the main menu: your labels, **+ New label**, and **Connect to Claude**.
3. Tap **+ New label** and fill it in:
   - **Page title:** the name of the item, for example `Camera`.
   - **Tag address:** a short name in lowercase, for example `camera`. This becomes `project-name.pages.dev/camera`.
   - **Page tape color:** pick a preset, or tap **Custom**.
   - **Text style:** off, the tag follows the site's text style from **Settings** (the label font, unless you changed it). Turn the switch on to use the other font for this tag's notes and small text. Titles and strips are always label tape.
   - **Blocks:** use the buttons under **Add a block** to add strips. Use the arrows to reorder and ✕ to remove.
4. Tap **Save tag**. The address is copied for you, and the page goes live about a minute later.
5. Write it onto the NFC sticker:
   - **Android (Chrome):** tap **Write to tag** and hold the sticker against the back of the phone.
   - **iPhone (or anything else):** install the free **NFC Tools** app. Tap **Write → Add a record → URL**, paste the address, tap **OK**, then **Write**, and hold the sticker near the top of the phone.
6. Once it works, **lock the tag** (NFC Tools → **Other** → **Lock tag**) so nobody can overwrite it. Locking is permanent, but you can still change the page anytime, because the sticker only holds the address.

To change or delete a tag later, open `/new` and use **Edit** or the bin next to it on the main menu.

### 7. Connect Claude (optional)

Claude can then list, make, change and delete labels for you.

1. Open `/new`. Under **Connect to Claude**, tap **Copy** (or **Connect to Claude**, which copies the address and opens Claude's settings).
2. In Claude, open **Settings › Connectors**, tap **Add custom connector**, name it `Phygital labels`, and paste the address (`https://project-name.pages.dev/mcp`).
3. Tap **Connect**. Your site opens and asks whether to allow Claude. Enter your `ADMIN_PASSWORD` if asked and tap **Allow**.
4. Ask Claude, for example: *"Make a label for my espresso machine with the manual and a descaling video."* It replies with the address to write on the sticker.

Claude Code works too: `claude mcp add --transport http phygital-labels https://project-name.pages.dev/mcp`.

To disconnect Claude, use **Settings › Sign out everywhere**.

### Settings

The **Settings** tab on the main menu has:

- **Text style:** a switch for the regular (easier to read) font instead of the label font, for every label that hasn't switched its own, and for the phygital label maker's screens. Labels switch over about a minute after you change it.
- **Connect to Claude:** tap to open the connector address and steps (above).
- **Site health:** checks that GitHub is connected and warns when your GitHub token is about to expire, so you know to make a new one before saving stops working.
- **Back up:** downloads every label in one JSON file.
- **Sign out everywhere:** after about a minute, every phone (including yours) needs the password again and Claude has to be reconnected. Use it if a phone is lost.

Settings are saved in `public/tags/_settings.json` in your repo. The underscore keeps it from ever being a tag address, and the file is never shown on the website.

---

## The blocks

| Block | What it shows |
| --- | --- |
| **Link** | A tape strip that opens a web address (must start with `https://` or `http://`). If you haven't added the address yet, it shows faded and can't be tapped. |
| **Text** | A paper note. Line breaks are kept. Add a link inside text like this: `[the manual](https://example.com)`. |
| **Video** | A YouTube video (youtube.com, youtu.be or Shorts links). It shows the thumbnail, and the player only loads when someone taps it, using YouTube's privacy-enhanced mode. |
| **Menu** | A strip with a second strip peeking out behind it. It opens another page of the same tag, which has its own color and blocks. Choose **+ New page** to make one. |
| **Heading** | A small strip that labels a section. Not clickable. |

Link, Menu and Heading strips can each have their own color. Letters switch to dark ink on light tape automatically.

Addresses and links always show in a plain monospace font, even with the label font on, because the label font only has capital letters and would hide the real case.

## Privacy

- No page lists your tags. Someone has to know (or tap) the exact address.
- Every page tells search engines not to index it, and `robots.txt` asks crawlers to stay away.
- Your tag files live in your private repo, and the raw files are not served on the website.
- Pages are still public to anyone who has the address, so don't put anything secret on a tag.

## How it works (for the curious)

```
public/                  what the website serves
  new.html               the phygital label maker (/new)
  assets/label.js        draws the label tape, shared by pages and the live preview; also checks tags
  assets/label.css       the embossed look
  assets/editor.*        the phygital label maker's screens
  assets/page.js         loads a video when tapped
  fonts/                 fonts and their licences
  tags/<address>.json    one file per tag
  _routes.json, _headers, robots.txt
functions/               small server programs (Cloudflare Pages Functions)
  [tag].js               draws /<tag>
  [tag]/[page].js        draws /<tag>/<page>
  api/login.js           checks the password, sets a signed 30-day cookie
  api/tags.js            lists every tag for the main menu
  api/settings.js        site settings and the health check
  api/backup.js          downloads every tag in one file
  api/reset-access.js    "Sign out everywhere"
  _middleware.js         loads the site settings for every request
  api/tag/[slug].js      loads, saves and deletes tags through the GitHub API
  mcp.js                 the Claude connector (MCP server) at /mcp
  oauth/*.js             Claude's sign-in: register, the Allow page, tokens
  .well-known/*          tells Claude where to sign in
lib/                     shared server code (password check, GitHub, labels, OAuth, MCP tools, page shell)
```

When you save, the server checks everything again, then commits `public/tags/<address>.json` to your repo with the GitHub API. Cloudflare sees the new commit and redeploys the site. Pages are drawn on the server from those files, so they load fast and work without JavaScript.

**Security details:**
- The password is compared in constant time.
- Every wrong guess waits about 2 seconds, and 5 wrong guesses lock that address out for 15 minutes. This lockout is best-effort, because the long password is what really protects you.
- Any password length is allowed (it just can't be empty). Short ones are easier to guess, and the lockout above is the only thing slowing guesses down.
- All text is escaped before it's shown, and a strict Content-Security-Policy blocks injected scripts.
- Only `http`/`https` links and YouTube videos are accepted.
- Claude connects with OAuth 2.1 (PKCE required). Nothing is stored: client ids, codes and tokens are signed with a key made from `ADMIN_PASSWORD` and a counter in the settings file, which **Sign out everywhere** bumps (login cookies use the same counter). Access tokens last an hour and refresh tokens 90 days. The Allow page shows which site will receive access, and always asks for your password.
- Everything Claude sends goes through the same checks as the label maker.
- Logins only work on the address they were made on, and Claude's sign-in page always asks for the password.
- **If your password ever leaks:** change `ADMIN_PASSWORD` in Cloudflare and redeploy, then make a new GitHub token and **delete the old one on GitHub**. Cloudflare keeps every past deployment running at its own address (like `abc123.project-name.pages.dev`) with the old settings, so deleting the old token is what cuts those off.

**Editing a tag file by hand** works too: open `public/tags/<address>.json` on GitHub and click the pencil. The format:

```json
{
  "v": 1,
  "font": "label",
  "pages": [
    { "slug": "", "title": "Camera", "color": "#161616", "blocks": [
      { "type": "link", "label": "Manual", "url": "https://example.com/manual" },
      { "type": "menu", "label": "Settings", "page": "settings" }
    ] },
    { "slug": "settings", "title": "Settings", "color": "#1B4A9E", "blocks": [] }
  ]
}
```

`"font"` is `"label"` or `"regular"`; leave it out to follow the site default from Settings. The first page is the main page (`"slug": ""`). Addresses use lowercase letters, numbers and dashes. `new`, `api`, `assets`, `fonts`, `tags`, `robots`, `index`, `functions`, `admin`, `404`, `mcp` and `oauth` are reserved.

## Troubleshooting

- **"ADMIN_PASSWORD is not set"**: add it in Cloudflare (step 4), then **Retry deployment**.
- **"Your GitHub key has expired"** (or **"GitHub did not accept GITHUB_TOKEN"**): your labels and stickers keep working, but making and changing labels needs a new token. The label maker shows the steps when this happens, and warns you 14 days ahead: make a new token (step 3), replace `GITHUB_TOKEN` in Cloudflare, and retry the latest deployment.
- **"GitHub could not find the repo"**: check `GITHUB_REPO` is exactly `your-name/my-tags`, and that the token was given access to that repo.
- **Saved, but the page says "Nothing here"**: wait a minute for Cloudflare to finish redeploying. You can watch it on the project's **Deployments** tab.
- **"Too many wrong tries"**: wait 15 minutes.

**Free plan limits:** each save starts one Cloudflare deploy, and the free plan allows 500 a month. Pages can be viewed without limit, and the phygital label maker can be used about 100,000 times a day, which is plenty for personal use.

## Licence

Code: MIT (see `LICENSE`). Fonts: see `public/fonts/LICENSES.txt`.
