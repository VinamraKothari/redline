-- Redline — migration 004: per-user read / unread state of comment threads
-- Run once in the Supabase SQL editor. Idempotent.

create table if not exists public.review_reads (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  review_id  text not null references public.reviews (id) on delete cascade,
  reads      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, review_id)
);

alter table public.review_reads enable row level security;

-- The API talks to the database with the secret key; these policies only
-- matter if the table is ever reached with a user session.
drop policy if exists "own read state" on public.review_reads;
create policy "own read state" on public.review_reads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
