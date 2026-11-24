# Copy edits (text edits)

The Text tool lets an editor change the copy of a reviewed page in place —
like editing text in Figma — without touching the live site. Edits are
stored in Redline, re-applied in the frame on every load, listed in the
**Copy** tab, and handed to developers as Markdown, Jira rows or through the
agent API. This page describes the data, the API and the rules; the UI lives
in the workspace components.

## Data model

`supabase/migration-010-text-edits.sql` (run once in the SQL editor;
idempotent, only adds a table):

| Column | |
| --- | --- |
| `id` | text, primary key |
| `review_id` | the page; `on delete cascade` with the review (and so with its project) |
| `selector` | `buildSelector()` of the edited block; **unique per review** |
| `label` | human location, e.g. `the heading “Login”` (≤ 140 chars) |
| `before_html`, `before_text` | the block's inline HTML when it was first edited, and its normalized text |
| `after_html`, `after_text` | the copy the owner wants, and its normalized text |
| `viewport_width` | where the edit was made (informational: edits apply at every width) |
| `status` | `open` or `done` |
| `note` | optional, ≤ 1000 chars |
| `author_id`, `author_name`, `author_color` | who made it first; `author_id` is set null when the account is deleted |
| `created_at`, `updated_at` | |

RLS is on. The browser may only **read** rows of reviews in projects it
belongs to (`public.can_read_review(review_id)`, as for comments and
shapes) — that is what the realtime feed needs; every write goes through the
API with the service key. The table is in the `supabase_realtime`
publication with `replica identity full`.

The local JSON store (`.data/redline.json`) gains a `textEdits` map; deleting
a review or project drops its edits, deleting an account keeps its edits
unattributed — the same as the Postgres foreign keys.

Until the migration has run on Supabase, pages simply have no edits
(every read answers "none"); saving one fails with
"Text edits are not set up yet — run migration 010 first."

## Rules

- **One edit per block.** Saving a block that already has an edit updates
  that row: `before_*`, `label`, author and `created_at` stay from the first
  save; new copy reopens an edit that was marked done.
- **Reset = the original again.** When the new copy is the original's —
  same words, punctuation, line breaks and formatting (classes included);
  spacing doesn't count: `&nbsp;` for a space, doubled spaces, blanks at the
  ends or around a line break — the edit is deleted (`PUT`/`PATCH` answer
  `{ deleted }`). See `sameCopy` in `diff.ts`.
- **Copy edits belong to the page.** Anyone with edit access may change, mark
  done, reset or restore any edit; viewers may read and copy them.

## Statuses

Stored: `open`, `done`. On every load the reviewer compares the block it finds
with the stored texts (normalized):

| Found block's text | Shown as | Applied in the frame? |
| --- | --- | --- |
| equals `before_text` | Open / Done (as stored) | yes |
| equals `after_text` | **Live on the site** — the developer shipped it | no (already there) |
| neither | **Out of date** — the page changed underneath | no; both texts listed |
| selector finds nothing | **Not found** | no |

## API

All routes need a signed-in member of the review's project (others get 404);
writes need edit access (viewers get 403). An edit id of another review is a
404 on this review's routes.

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/reviews/[id]/text-edits` | | `{ edits }`, oldest first |
| `PUT /api/reviews/[id]/text-edits` | `{ selector, label, before_html, after_html, viewport_width, note? }` | `{ edit }`, or `{ deleted: id \| null }` when the copy equals the original |
| `PATCH /api/reviews/[id]/text-edits/[eid]` | `{ status?, note?, after_html? }` | `{ edit }`, or `{ deleted: id }` (copy back to the original) |
| `DELETE /api/reviews/[id]/text-edits/[eid]` | | `{ ok, edit, token }` — the deleted row and its undo token |
| `DELETE /api/reviews/[id]/text-edits` | | `{ ok, edits, tokens }` — "Restore all": the deleted rows, `tokens[i]` for `edits[i]` |
| `POST /api/reviews/[id]/text-edits/restore` | `{ tokens }` (≤ 200, body ≤ 2 MB) | `{ edits, skipped }` — undo: rows back as they were |

Limits (400 otherwise): `selector` 1–1000 chars, `label` ≤ 140, each html
≤ 200 000 characters as sent **and** ≤ 20 000 once sanitized (a site's
per-word spans mostly disappear when cleaned), `note` ≤ 1000 (empty = none),
`viewport_width` a whole number 200–4000, `status` `open`/`done`.
Sanitizing is linear in the input, so the largest request is quick.

The server never trusts the client's HTML: both htmls are sanitized and the
texts recomputed on every write. New copy through `PATCH` reopens a done
edit, as a `PUT` does.

**Undo tokens.** `restore` re-inserts only rows the DELETE routes returned:
each comes with a token carrying the row, its review and an expiry (24 h),
HMAC-SHA256-signed with a server key (`REDLINE_UNDO_KEY`, else derived from
the Supabase secret or `REDLINE_SITE_SESSION_KEY`; a fixed key for local
development) — `src/lib/text-edits/undo.ts`. A forged, altered, expired or
other-page token fails the whole request (400); so an undo brings back
exactly what was deleted (same id, author, times, status) and can't create
anything else. A row whose block meanwhile got a different edit, or whose
copy is the original again, is not restored: its id is in `skipped`.

Client: `api.textEdits.list / put / patch / remove / removeAll / restore`
(`src/lib/api.ts`); `remove` → `{ ok, edit, token }`, `removeAll` →
`{ ok, edits, tokens }`, `restore(reviewId, tokens)`. Store: `textEdits`, `textView`
(`"original" | "edited" | "changes"`), `setTextEdits`, `upsertTextEdit`,
`removeTextEdit`, `setTextView`; `src/lib/realtime.ts` keeps `textEdits` in
sync (change feed, or polling without Supabase).

## Sanitizer (`src/lib/text-edits/sanitize.ts`)

Pure and DOM-free, so the API (Node) and the reviewer (browser) clean HTML
with the same code. `sanitizeInline(html)`:

- keeps text, `<br>`, `<strong>` (from `<strong>`/`<b>`), `<em>` (from
  `<em>`/`<i>`), `<u>`, `<a href>` and `<span class>`;
- keeps the site's styling hooks so the copy looks exactly as before: a
  `class` on `span`, `a`, `strong`/`b`, `em`/`i` and `u` — space-separated
  tokens matching `^[A-Za-z0-9_\-:/\[\]#.%()!,=]+$` (Tailwind-style), at most
  20 tokens and 300 characters, duplicates and other tokens dropped; no
  `style`, `id` or `data-*`. A `<span>` without a usable class is unwrapped
  (contentEditable's style spans); a link without a safe address keeps its
  class as a span;
- keeps a link only with an `http:`, `https:`, `mailto:` or `tel:` address or
  a relative/root-relative path, `?query` or `#fragment`, read the way a
  browser reads it (entities decoded, tabs and newlines removed) and checked
  again with `new URL()` — so `jav&#x09;ascript:` and friends lose the link
  but keep the text; only `href` (and `class`) survive, nothing is added;
- turns block elements (`div`, `p`, `li`, headings, …) into line breaks —
  what contentEditable makes of Enter;
- drops every other tag but keeps its text, and drops `script`, `style`,
  `svg`, `math`, `iframe`, `template`, `textarea`, `object`, media and the
  like **with** their content; comments, CDATA, doctypes and processing
  instructions vanish; every attribute except a link's `href` is dropped;
- merges neighbouring stretches with the same formatting, removes empty
  marks, keeps the nesting order of the source (the site's CSS may depend on
  it; an identical mark inside itself is dropped, a link inside a link
  replaces it, at most 24 levels), turns lone UTF-16 surrogates into U+FFFD
  and re-encodes text (`&amp;`, `&lt;`, `&gt;`, `&nbsp;`) and attributes —
  so `sanitizeInline(sanitizeInline(x)) === sanitizeInline(x)`;
- caps the result at 20 000 characters (`sanitizeChecked` says whether it
  had to cut; the API answers 400 then). Every step is linear in the input.

`normalizeText(html)` is the text with whitespace (line breaks and `&nbsp;`
included) collapsed to single spaces and trimmed.

## Track changes (`src/lib/text-edits/diff.ts`)

`diffInline(beforeHtml, afterHtml)` returns segments
`{ kind: "equal" | "insert" | "delete", text, marks, prevMarks? }`
(`"\n"` in `text` is a line break). `marks` lists the formatting outermost
first: `"strong" | "em" | "u" | { a: href }` without a class, and with the
site's class `{ strong: cls } | { em: cls } | { u: cls } | { a: href, class: cls } | { span: cls }`. It is a word-level Myers diff on tokens — words, single punctuation
marks, whitespace, line breaks — matched on their text only: a whitespace
change is no change, and words whose formatting alone changed come back as
`equal` with `prevMarks` — a class change counts, the nesting order alone
doesn't. A lone space between two changes joins them, and
deletions come before insertions.

`renderChangesHtml(segments)` writes `<ins data-rl-ins>`, `<del data-rl-del>`
and `<span data-rl-fmt title="bold added, …">`; the reviewer styles them in
the frame with background, text-decoration and colour only.

## Hand-off (`src/lib/text-edits/format.ts`)

- `toMarkdown(html)`: `**bold**`, `*italic*`, `<u>underline</u>`,
  `[text](href)`, line breaks as two spaces + newline. Classes and spans
  don't travel; markers close before a line break and reopen after it; a
  line starting with `#`, `-`, `+`, `=` or `1.` is escaped.
- `toJira(html)`: `*bold*`, `_italic_`, `+underline+`, `[text|url]`, with the
  same rules (`#`, `-`, `h1.`, `bq.` at a line start escaped); a selector with
  braces is written as escaped text instead of `{{…}}`.
- `handoffText(edit, title, url, { format?, status?, page? })` — the block a
  developer pastes:

  ```
  Page: Checkout — https://shop.test/checkout
  Where: the heading “Login” (selector: `main h1`)
  Before: Log in to view your orders
  After: **Sign in** to view your orders
  Note: …
  ```
- `handoffAll(edits, review, { format? })` — every edit of a page under one `Page:` line.

**Jira CSV** (`/api/reviews/[id]/export?format=jira`, and `toJiraCsv(…, textEdits)`):
one row per edit after the threads — Summary `Copy change: <label>`,
Description = `handoffText` in Jira markup with a Status line and the
Redline link, Task, Medium, To Do/Done, label `copy-change`. Every CSV cell
that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a
leading `'`, so a spreadsheet shows it as text instead of running it
(labels, titles and names are typed by users) — comment rows included.
**Markdown export** adds a "Copy changes" section. **Agent API**: see
[agent-api.md](agent-api.md) — edits are items with `kind: "copy"`.

Deep link to an edit: `/r/<review>?copy=<edit id>`.

## Using it

**Edit.** Press **T** (or the **T** tool in the left rail — editors and
admins only) and hover the page: every text block gets a dotted teal
outline. Click one to edit it in place; the caret lands where you clicked
and the page reflows as you type. The toolbar above the block has Bold,
Italic, Underline, Link (an address field: `https://…`, `mailto:`, `tel:`
or a path like `/pricing`; a bare `acme.com/x` gets `https://`), Reset to
original and Done.

| Key | |
| --- | --- |
| Enter | save (so does Done, or a click anywhere else) |
| Shift+Enter | line break |
| Esc | discard this editing session; Esc again leaves the tool |
| ⌘/Ctrl+B, I, U | bold, italic, underline (a caret formats the word it's in) |
| ⌘/Ctrl+K | link |
| ⌘/Ctrl+A | select the block's copy |
| ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z, Ctrl+Y | undo / redo while editing |
| ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z (not editing) | undo / redo the last saved copy action — a save, a reset, Restore all. In the Text tool always; in Browse, Comment and Inspect when it is newer than the last visit to the Draw tool (whose ⌘Z undoes drawings) |
| Shift+T | Original → Edited → Changes |

Pastes are plain text (line breaks kept). While the tool is on, the page's
own scripts get no clicks, pointer or key events at all — links don't
navigate, buttons and forms don't fire, site shortcuts stay quiet — and
Redline's own shortcuts keep working. Leaving the page with unsaved copy in
the block being edited asks first.

**Which block.** A block starts at the element under the pointer that has
words of its own, and grows to its parent only when the parent has words of
its own too (a styled span or link inside a sentence belongs to the
sentence) or when it is plain bold/italic/underline around the parent's
copy. So the links of a nav stay separate blocks, and a button's label span
is edited on its own. Icons at either end of a block — `<button><svg/>Save
changes</button>`, `<a><svg/> Read the docs</a>`, an icon font's empty `<i>`
— are kept exactly as they are: only the copy between them is edited and
saved. Copy that can't be written back as it is says "This text can't be
edited here" on hover: an image or icon between its words, a block or form
control inside it, or inline formatting the sanitizer doesn't keep
(`<sup>`, `<code>`, `<s>`, `<small>`, … — the words inside such an element
can still be edited on their own).

**Typography stays the page's.** An edit only replaces the copy of its
block — the element keeps its classes, inline styles and icons. Inside the
copy, the site's inline elements keep their element and class through
typing, formatting, pasting and line breaks (`<span class="text-indigo-600
font-semibold">`, a link's `class`, a classed `<strong>`), so every
unchanged word renders exactly as on the live page. New formatting is
written as `<strong>`, `<em>`, `<u>` and `<a href>` (a new link borrows
the class of the block's other links), never `<span style>` or `<font>`; the
editor doesn't use `document.execCommand`. `<b>` and `<i>` are saved as
`<strong>` and `<em>` (CSS that targets `b` or `i` by name won't match them).
Bold in a block that is already bold — a heading at weight 600 or more —
renders one step bolder (`strong` is `font-weight: bolder`, as on the live
site), which a font without a heavier cut can't show. Links to the reviewed
site are saved as the site writes them (`/guide`, not the absolute address
the reviewer's proxy turned them into).

**Emptying a block.** Saving a block with all of its text deleted asks
"Remove all of this text?" in the toolbar (Remove saves it, Keep editing
goes back); a click elsewhere puts the text back instead of saving it.

**The click that starts editing** is handled by Redline: the block may
switch from track changes to the new copy under the pointer, so the caret,
a double-click (the word) or triple-click (all of the copy) and a drag are
mapped from where the press was into the new copy.

**Views** (top bar, shown once the page has copy changes or the tool is on;
a menu on narrow screens):

- **Original** — the page as the site serves it.
- **Edited** — the new copy, exactly as the live site would show it: no
  colours, strikethroughs, outlines or anything else on the page.
- **Changes** — track changes: new copy tinted teal with a soft highlight,
  removed copy struck through in red (with a hair of space before what
  replaced it), formatting-only changes dotted underlined; changed blocks
  get a faint dashed outline (drawn by Redline over the page, not on it).

The Text tool switches to Changes and back to the previous view when you
leave it; a view you pick is remembered for the page in that browser tab.

**Copy tab** (right panel): every change in the order it appears on the
page (blocks that aren't there go last) with its location, before → after,
author and time, and its status — Open, Done, Live on the site, Out of date,
Not found (also: the selector names something that can't hold copy, such as
the page title or a form) or **Page keeps replacing it** (the page
re-rendered the block more than 20 times in 10 seconds, so Redline stopped
writing the new copy into it). Click a row to scroll to the block and flash
it. Per row: Jump, Copy (Markdown hand-off), Note, Mark done / Reopen, Reset
to original. In the header: Copy all (Markdown for the whole page) and
Restore all on this page (with a confirmation and an Undo). Viewers see the
tab, switch views and copy; they can't edit, reset or mark anything.

Undo of a reset or Restore all hands the DELETE route's signed tokens back
to `restore`. New copy for a block whose edit is live on the site or out of
date starts a fresh edit from the page's text today: the API keeps an
edit's `before_*`, so the old edit is deleted first (its token kept: a
failed save puts it straight back, and ⌘Z restores it).

**Captures use the original.** Freeze, "Save this state as a new page" and
Compare with Figma read the page with its original copy and without any
trace of the Text tool (its cursor stylesheet, the edited block's
`contenteditable`): copy edits stay in Redline, on top of the page. (The PNG
export renders whatever the reviewer shows at the time — copy edits in the
current view.)

Implementation: `src/lib/text-edits/apply.ts` (puts edits into the frame and
works out statuses; a per-document registry of WeakMaps remembers each
block's original — nothing is written onto the page's elements), `slot.ts`
(which part of a block is copy: the icons at its edges stay), `editor.ts`
(the in-place editing session), `actions.ts` (saves and the page-level undo
stack), `sync.ts`, `useTextEdits.ts`,
`components/workspace/layers/TextLayer.tsx` and
`components/workspace/panels/CopyPanel.tsx`. The tests run against
`tests/fixtures/site.html` and a Next/Tailwind-style page,
`tests/fixtures/copy-next.html`.
