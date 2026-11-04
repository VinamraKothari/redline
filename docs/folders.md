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
