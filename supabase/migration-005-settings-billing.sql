-- Redline — migration 005: per-account settings, subscriptions (Stripe) and
-- "Compare with Figma" run counts. Run once in the Supabase SQL editor. Idempotent.

-- ── Settings ───────────────────────────────────────────────────────────────
create table if not exists public.user_settings (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Subscriptions (one row per account, mirrored from Stripe by the webhook) ─
create table if not exists public.subscriptions (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  plan                   text not null default 'free' check (plan in ('free', 'pro', 'team')),
  status                 text not null default 'none',
  interval               text check (interval in ('month', 'year')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  price_id               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);
create unique index if not exists subscriptions_customer_idx on public.subscriptions (stripe_customer_id) where stripe_customer_id is not null;
alter table public.subscriptions enable row level security;
drop policy if exists "own subscription" on public.subscriptions;
create policy "own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

-- ── Figma comparison runs (for the free plan's monthly allowance) ──────────
create table if not exists public.figma_runs (
  id        bigserial primary key,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  review_id text,
  at        timestamptz not null default now()
);
create index if not exists figma_runs_user_at_idx on public.figma_runs (user_id, at desc);
alter table public.figma_runs enable row level security;
drop policy if exists "own runs" on public.figma_runs;
create policy "own runs" on public.figma_runs
  for select using (auth.uid() = user_id);
