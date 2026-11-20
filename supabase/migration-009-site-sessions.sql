-- Redline — migration 009: site sessions (reviewing pages behind a login)
-- Run once in the Supabase SQL editor. Idempotent. Only adds a table.
--
-- When someone signs in to a reviewed site in Browse mode, the proxy keeps
-- the cookies that site set — for that Redline account only — so the page
-- behind the login can be reviewed. One row per (account, site); `site` is
-- the registrable domain (see src/lib/proxy/cookies.ts#siteKeyOf). `cookies`
-- is the cookie array, or `{"enc": "…"}` when REDLINE_SITE_SESSION_KEY seals
-- it (see docs/site-sessions.md). Deleting the account deletes its sessions.
create table if not exists public.site_sessions (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  site        text not null,
  cookies     jsonb not null default '[]',
  updated_at  timestamptz default now(),
  primary key (user_id, site)
);

-- API only (service key, which bypasses RLS): no browser ever reads a jar.
-- RLS with no policies keeps the anon/authenticated keys out.
alter table public.site_sessions enable row level security;
