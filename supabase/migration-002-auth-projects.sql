-- Redline — migration 002: Google sign-in, projects, members & roles
-- Run once in the Supabase SQL editor after schema.sql. Idempotent.

-- ── Profiles (one row per Google account, kept in sync at sign-in) ─────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null,
  avatar_url  text,
  color       text not null default '#e2342b',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists profiles_email_idx on public.profiles (lower(email));

-- ── Projects ───────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id          text primary key,
  name        text not null,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id  text not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('view', 'edit', 'admin')),
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);

-- Invitations by e-mail; claimed automatically when that address signs in.
create table if not exists public.project_invites (
  id          text primary key,
  project_id  text not null references public.projects(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('view', 'edit', 'admin')),
  invited_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index if not exists project_invites_unique_idx on public.project_invites (project_id, lower(email));
create index if not exists project_invites_email_idx on public.project_invites (lower(email));

-- ── Reviews / comments / shapes get owners and a project ───────────────────
alter table public.reviews  add column if not exists project_id    text references public.projects(id) on delete cascade;
alter table public.reviews  add column if not exists created_by_id uuid references public.profiles(id) on delete set null;
create index if not exists reviews_project_idx on public.reviews (project_id, created_at desc);

alter table public.comments add column if not exists title     text;
alter table public.comments add column if not exists author_id uuid references public.profiles(id) on delete set null;
alter table public.shapes   add column if not exists author_id uuid references public.profiles(id) on delete set null;

-- ── Row level security ─────────────────────────────────────────────────────
-- All writes still go through the API (service key). The browser reads
-- comments and shapes directly with the signed-in user's JWT so the realtime
-- change feed can be filtered per user: you only see rows of reviews in
-- projects you are a member of.
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invites enable row level security;

create or replace function public.is_project_member(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members m where m.project_id = p and m.user_id = auth.uid());
$$;

create or replace function public.can_read_review(r text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.reviews v
    join public.project_members m on m.project_id = v.project_id
    where v.id = r and m.user_id = auth.uid()
  );
$$;

drop policy if exists "public read comments" on public.comments;
drop policy if exists "public read shapes"   on public.shapes;
drop policy if exists "members read comments" on public.comments;
drop policy if exists "members read shapes"   on public.shapes;
create policy "members read comments" on public.comments for select to authenticated using (public.can_read_review(review_id));
create policy "members read shapes"   on public.shapes   for select to authenticated using (public.can_read_review(review_id));

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
