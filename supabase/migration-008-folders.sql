-- Redline — migration 008: folders inside projects
-- Run once in the Supabase SQL editor. Idempotent. Only adds: no existing row
-- (review, comment, shape, thumbnail) is touched — every page keeps
-- folder_id = null, which means "at the project root".

-- ── Folders: one level deep (project → folder → pages), never nested ───────
create table if not exists public.folders (
  id          text primary key,
  project_id  text not null references public.projects(id) on delete cascade,
  name        text not null,
  position    integer not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists folders_project_idx on public.folders (project_id, position, created_at);

-- ── A page may sit in a folder of its project ──────────────────────────────
-- Deleting a folder puts its pages back at the root (set null); pages are
-- never deleted with a folder.
alter table public.reviews add column if not exists folder_id text references public.folders(id) on delete set null;
create index if not exists reviews_folder_idx on public.reviews (project_id, folder_id);

-- Folders are read and written through the API only (service key, which
-- bypasses RLS). Enabling RLS with no policies keeps the anon/authenticated
-- keys out, like every other table. The browser's direct reads of
-- comments/shapes keep their migration-002 policies, which select by project
-- membership and are unaffected.
alter table public.folders enable row level security;
