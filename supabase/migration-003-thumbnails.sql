-- Redline — migration 003: page previews
-- Run once in the Supabase SQL editor. Idempotent.

alter table public.reviews add column if not exists thumbnail_url text;
alter table public.reviews add column if not exists thumbnail_at  timestamptz;

-- Public bucket for the small JPEG previews shown on project pages.
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do update set public = true;
