# Redline

Design feedback on any live website. Load a page, leave Figma-style comments pinned to elements, draw on it, inspect type / colour / spacing, and share the marked-up canvas with a link.

## How it works

Most sites refuse to be iframed, and even when they allow it a cross-origin frame gives no access to fonts or layout. Redline fetches the page server-side (`/api/proxy`), strips frame-blocking headers, injects a small bridge script and re-serves the page from its own origin. Stylesheets and everything they reference (fonts, images) are routed through the proxy too, so self-hosted fonts without CORS headers still render — which matters when you're checking typography.

Because the page is now same-origin, the app can read the real DOM: hover box models, computed styles, distances between elements, and it can anchor comments to the element you clicked (so pins follow the layout rather than drifting).

**Freeze** serialises the rendered DOM (JS-rendered content included), inlines the live stylesheets and stores the result so everyone reviews the exact same version.

## Features

- **Comments** — click to pin, drag for a region, threads, @mentions, emoji reactions, edit/delete, resolve/reopen, image attachments, permalinks, unread badges, `N` / `Shift+N` navigation, per-viewport pins, panel grouped into Pending / Resolved.
- **Drawing** — pen, highlighter, line, arrow, rectangle, ellipse, text; colours, stroke widths, select/move, undo/redo; synced live.
- **Inspect** — hover box-model overlay, typography, colours (click to copy), box model, WCAG contrast, copy CSS; `Alt` + hover to measure distances between elements; `Ctrl` / `⌘` for deep-select of the innermost element; page-wide summary of fonts, colours, spacing and headings.
- **Viewports** — 1920 / 1440 / 1024 / 768 / 430 / 390 / 375 with a phone frame; zoom and fit.
- **Full-screen preview** (`F`) — see the page exactly as a visitor would.
- **Share** — review link, view-only link, comment permalinks, presence avatars and live cursors.
- **Export** — Jira-importable CSV, Markdown, PNG of the canvas.

Keyboard: `V` browse · `C` comment · `D` draw · `I` inspect · `F` full screen · `Shift+C` hide comments · `?` all shortcuts.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Radix primitives · Zustand · Supabase (Postgres, Realtime, Storage) · perfect-freehand · cheerio · Playwright.

## Running locally

```bash
npm install
cp .env.example .env.local   # optional — without Supabase, data is kept in .data/redline.json
npm run dev
```

Open http://localhost:3000, paste a URL.

## Supabase setup (production)

1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/schema.sql`.
3. Set these environment variables (locally in `.env.local`, on Vercel in Project → Settings → Environment Variables):

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API keys → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API keys → **publishable** key (legacy: anon) |
| `SUPABASE_SECRET_KEY` | Project Settings → API keys → **secret** key (legacy: service_role) — server only, never exposed |

The two public values are committed in `.env.production`; only the secret key needs to be added in Vercel.

Without these the app still runs, but data lives in a local JSON file and there is no realtime — fine for trying it out, not for sharing.

## Sign-in, projects and roles

Everyone signs in with Google (Supabase Auth). Reviews live in **projects**; only members can open them. Roles: **view** (open, read, export), **edit** (comment, draw, create and freeze reviews), **admin** (everything, plus members, invitations and deleting). Admins invite people by e-mail; access is granted the moment that address signs in with Google.

One-time setup:

1. Run `supabase/migration-002-auth-projects.sql` in the Supabase SQL editor (after `schema.sql`).
2. Google Cloud Console → *APIs & Services → Credentials → Create credentials → OAuth client ID* (type **Web application**).
   Authorized JavaScript origin: `https://<your-app-domain>`. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
   If prompted, configure the OAuth consent screen first (External, app name "Redline").
3. Supabase → *Authentication → Sign In / Providers → Google*: enable, paste the client ID and secret.
4. Supabase → *Authentication → URL Configuration*: Site URL `https://<your-app-domain>`; add `https://<your-app-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for development) to Redirect URLs.

For end-to-end tests (`REDLINE_TEST_AUTH=1`, never on Vercel) the login page offers a test user instead of Google.

## Tests

```bash
# builds, serves a fixture site on :3999, runs the Playwright suite
PW_CHROMIUM=/path/to/chrome bash scripts/e2e.sh
```

## Jira import

Share → Export → **Jira CSV**, then in Jira: Settings → System → External system import → CSV. The columns Summary, Description, Issue Type, Priority, Status, Labels, Reporter, Created, Comment and Attachment map automatically; `Redline URL`, `Element` and `Viewport` can go to custom fields or be skipped. Dates use Jira's default `dd/MMM/yy h:mm a` format.

A thread's optional **title** (set in the composer or by clicking the thread header) becomes the Summary; without one it is generated from the first line. Images attached to comments are listed in the `Attachment` columns as `date;author;filename;url` — Jira downloads each file from the URL during import. Those URLs (`/api/attachments/…`) are public but unguessable, so the Jira importer can fetch them without a Redline account.

## Limitations

- Pages behind login, aggressive bot protection, or SPAs that depend on their own origin may not render through the proxy — drop an `.html` file instead.
- Freeze captures what is rendered at that moment (the tool scrolls the page first so lazy content loads).
- Request bodies are capped at 4 MB (Vercel limit), which bounds uploads and freezes.
