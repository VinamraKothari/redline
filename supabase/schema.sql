-- Redline — Supabase schema
-- Run this once in the Supabase SQL editor (Database → SQL editor → New query).
-- Safe to re-run: every statement is idempotent.

create table if not exists public.reviews (
  id               text primary key,
  url              text not null,
  title            text not null,
  mode             text not null default 'live' check (mode in ('live', 'frozen', 'upload')),
  snapshot_path    text,
  default_viewport integer not null default 1440,
  created_by       text not null default 'Anonymous',
  owner_key        text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.comments (
  id             text primary key,
  review_id      text not null references public.reviews(id) on delete cascade,
  parent_id      text references public.comments(id) on delete cascade,
  author_name    text not null,
  author_color   text not null default '#e2342b',
  body           text not null default '',
  anchor         jsonb,
  viewport_width integer not null default 1440,
  resolved       boolean not null default false,
  reactions      jsonb not null default '{}'::jsonb,
  attachments    jsonb not null default '[]'::jsonb,
  edited_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists comments_review_idx on public.comments (review_id, created_at);

create table if not exists public.shapes (
  id             text primary key,
  review_id      text not null references public.reviews(id) on delete cascade,
  viewport_width integer not null default 1440,
  type           text not null,
  data           jsonb not null,
  style          jsonb not null,
  author_name    text not null default 'Anonymous',
  z              bigint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists shapes_review_idx on public.shapes (review_id, z);

-- Row level security. The browser only ever READS comments and shapes through
-- the anon key (that is what powers the realtime change feed). Reviews are
-- never read by the browser directly (owner_key must stay secret) and all
-- writes go through the app's API routes with the service-role key.
alter table public.reviews  enable row level security;
alter table public.comments enable row level security;
alter table public.shapes   enable row level security;

drop policy if exists "public read comments" on public.comments;
drop policy if exists "public read shapes"   on public.shapes;
create policy "public read comments" on public.comments for select using (true);
create policy "public read shapes"   on public.shapes   for select using (true);

-- Realtime: broadcast row changes and include the old row on DELETE so
-- clients can remove it.
alter table public.comments replica identity full;
alter table public.shapes   replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'comments') then
    alter publication supabase_realtime add table public.comments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shapes') then
    alter publication supabase_realtime add table public.shapes;
  end if;
end $$;

-- Storage bucket for frozen / uploaded page snapshots (private; served via the API).
insert into storage.buckets (id, name, public)
values ('snapshots', 'snapshots', false)
on conflict (id) do nothing;
