# Folders inside a project

A project can hold folders, and a page can sit in one of them. Folders are
**one level deep**: project → folders → pages. A folder never contains a
folder. Every member of the project sees every folder and every page in it;
folders change nothing about who may open what.

The project page also shows, on every page card and folder card, how many
threads are still unresolved: a red count for people's comments and, only
when there are any, a violet `</>` count for developer comments from
"Compare with Figma". Hover the badge for the sentence.

## Data model

`supabase/migration-008-folders.sql` (run once in the SQL editor; idempotent):

- `public.folders` — `id`, `project_id` (cascades with the project), `name`,
  `position` (manual order, ties by `created_at`), `created_by`, timestamps.
- `public.reviews.folder_id` — nullable reference to `folders.id` with
  `on delete set null`. `null` means "at the project root", which is what
  every existing page keeps after the migration. Nothing else is touched:
  comments, shapes, thumbnails and reviews stay exactly as they are.

The local JSON store (`.data/redline.json`) gains a `folders` map and the
same optional `folder_id` on reviews. Until the migration has run on
Supabase, the project page simply shows no folders; creating one answers
"Folders are not set up yet — run migration 008 first."

No RLS changes: folders are read and written through the API (service key).
The browser's direct reads of comments and shapes keep their migration-002
policies.

## Routes

| Where | What |
| --- | --- |
| `/p/[id]` | the project root: folder cards first, then the pages in no folder |
| `/p/[id]/f/[fid]` | inside a folder: only its pages; the add-page box creates pages in it |
| `GET /api/projects/[id]` | now also `folders` (ordered) and `counts` (`{ [reviewId]: { open, dev } }`) |
| `POST /api/projects/[id]/folders` `{ name }` | create (edit role; name 1–60 chars) |
| `PATCH /api/projects/[id]/folders/[fid]` `{ name?, position? }` | rename / reorder |
| `DELETE /api/projects/[id]/folders/[fid]` | delete; its pages go back to the root |
| `PATCH /api/reviews/[id]` `{ folder_id }` | move a page (`null` = root); 400 when the folder belongs to another project |
| `POST /api/reviews` `{ …, folder_id }` | create a page inside a folder |

Admins and editors may create, rename and delete folders and move pages;
viewers only browse. Moving a page to another project clears its folder.

## In the UI

- **New folder** next to the "Pages in this project" heading: type a name,
  Enter saves, Esc cancels.
- Folder card menu (⋯): Open, Rename, Delete folder…
- Page card menu (⋯): **Move to folder…** opens a dialog listing the root
  and every folder with its page count; the current place is marked.
- **Drag and drop**: drag a page card onto a folder card. Inside a folder,
  drop a card on the project's name in the breadcrumb to move it back to
  the root. This is native browser drag and drop, which touch screens don't
  offer — on a phone or tablet, use "Move to folder…" instead.

## What deleting a folder does

Only the folder row goes. Its pages get `folder_id = null` first and appear
at the project root again, with all their comments, drawings and previews
untouched. The confirmation dialog says so: "The N pages inside move back to
the project — nothing is deleted."

## Selecting several pages

Page cards can be selected the way files are in a file manager, then moved
or deleted together. Folders are not selectable — they stay drop targets.

- **Rubber band**: press on empty background around or between the cards
  and drag; a blue rectangle selects every card it touches. Hold Ctrl (Cmd
  on a Mac) to toggle those cards within the existing selection instead.
  Dragging near the top or bottom edge scrolls the page. It works with a
  mouse or pen; on a touch screen the finger scrolls instead.
- **Click** a card's preview or its padding to select just that card;
  **Ctrl/Cmd+click** adds or removes one; **Shift+click** selects the range
  from the last clicked card, in the order the grid shows them. The title
  is still a link, and a **double-click** on the preview opens the page.
  On a touch screen a tap on the preview opens the page, as before.
- **Keys**: Ctrl/Cmd+A selects every page in view (the project root or the
  open folder), Esc clears, Delete or Backspace asks to delete the selection.
  A click — or a right-click — on empty background clears too.

With one or more cards selected, a bar at the bottom of the window offers
**Move to folder…**, **Move to project…** and **Delete** for all of them
(viewers see only the count). Deleting asks first, and only deletes what
the caller may delete — an admin any page, an editor the pages they
created; the dialog says "2 of 3 can be deleted" when that is fewer than
were selected. Each page is a separate API call (`PATCH` or `DELETE
/api/reviews/[id]`), run together; failures are reported in one line just
above the bar, and the page reloads to show where everything really is.
Deleting a single page from its menu uses the same dialog. A page that
leaves the view (moved, deleted) also leaves the selection.

**Dragging** a selected card drags the whole selection — the pointer
carries a small stack with the count — onto a folder card, or inside a
folder onto the project's name in the breadcrumb. Dragging a card that is
not selected moves only that card. The drag carries a JSON array of review
ids under `text/redline-review`; a bare id is still accepted.

**Right-click** a card for the same actions as its ⋯ menu (plus "Open in
new tab"); when the card is part of a selection of several, the menu acts on
all of them ("Move 3 pages to folder…", "Delete 3 pages…", "Open all in new
tabs" — the browser may ask to allow pop-ups for the extra tabs).
Right-click a folder for Open, Rename and Delete folder…, and the empty
background for New folder, Select all and — inside a folder — Back to
project. Shift+F10 or the context-menu key opens the same menu for the card
that has the keyboard focus; the ⋯ button remains the accessible path.
