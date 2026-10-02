-- Redline — migration 006: admins, manual plan grants, redeemable codes, audit log.
-- Run once in the Supabase SQL editor after migration 005. Idempotent.

-- ── Admins (the people who may open /admin; the owner is seeded by e-mail) ──
create table if not exists public.admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins read themselves" on public.admins;
create policy "admins read themselves" on public.admins for select using (auth.uid() = user_id);
insert into public.admins (user_id, note)
select id, 'owner' from public.profiles where lower(email) = 'vinamra.kothari@gmx.de'
on conflict (user_id) do nothing;

-- ── Subscriptions learn where a plan came from ──────────────────────────────
alter table public.subscriptions add column if not exists source     text not null default 'stripe' check (source in ('stripe', 'manual', 'code'));
alter table public.subscriptions add column if not exists note       text;
alter table public.subscriptions add column if not exists granted_by uuid references public.profiles (id) on delete set null;
alter table public.subscriptions add column if not exists expires_at timestamptz;

-- ── Redeemable codes: "PRO3M" → three months of Pro, no card needed ────────
create table if not exists public.grant_codes (
  code        text primary key,
  plan        text not null check (plan in ('pro', 'team')),
  months      integer not null check (months between 1 and 120),
  max_uses    integer not null default 1 check (max_uses >= 1),
  uses        integer not null default 0,
  active      boolean not null default true,
  expires_at  timestamptz,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create table if not exists public.grant_redemptions (
  code       text not null references public.grant_codes (code) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  at         timestamptz not null default now(),
  primary key (code, user_id)
);
alter table public.grant_codes enable row level security;
alter table public.grant_redemptions enable row level security;

-- ── Audit log: who changed whose plan, created which code, and when ─────────
create table if not exists public.audit_log (
  id              bigserial primary key,
  actor_id        uuid references public.profiles (id) on delete set null,
  action          text not null,
  target_user_id  uuid references public.profiles (id) on delete set null,
  details         jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now()
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_user_id, at desc);
alter table public.audit_log enable row level security;

-- ── Admin queries ──────────────────────────────────────────────────────────
-- Everyone who shares a project with an admin (members of projects an admin owns).
create or replace view public.admin_collaborators as
  select distinct pm.user_id
  from public.project_members pm
  join public.projects p on p.id = pm.project_id
  join public.admins a on a.user_id = p.created_by
  where pm.user_id <> p.created_by;
