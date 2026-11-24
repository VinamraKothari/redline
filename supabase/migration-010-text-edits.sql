-- Redline — migration 010: copy edits ("Text" tool, "Copy" tab)
-- Run once in the Supabase SQL editor. Idempotent. Only adds a table: no
-- existing review, comment, shape or thumbnail is touched.
--
-- A copy edit is a change to the text of one block on a reviewed page. It
-- lives only in Redline (the site is never changed) and is re-applied in the
-- reviewer on every load. One row per (review, block selector): saving the
-- same block again updates the row and keeps the `before_*` of the first
-- save. Both htmls are sanitized inline HTML (text, <br>, <strong>, <em>,
-- <u>, <a href>); see docs/text-edits.md.
create table if not exists public.text_edits (
  id              text primary key,
  review_id       text not null references public.reviews(id) on delete cascade,
  selector        text not null,
  label           text not null default '',
  before_html     text not null default '',
  before_text     text not null default '',
  after_html      text not null default '',
  after_text      text not null default '',
  viewport_width  integer not null default 1440,
  status          text not null default 'open' check (status in ('open', 'done')),
  note            text,
  author_id       uuid references public.profiles(id) on delete set null,
  author_name     text not null default 'Anonymous',
  author_color    text not null default '#e2342b',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (review_id, selector)
);
create index if not exists text_edits_review_idx on public.text_edits (review_id, created_at);

-- Writes go through the API (service key, which bypasses RLS). The browser
-- only reads, for the realtime change feed — and only the edits of reviews in
-- projects it belongs to, exactly like comments and shapes (migration 002).
alter table public.text_edits enable row level security;
drop policy if exists "members read text edits" on public.text_edits;
create policy "members read text edits" on public.text_edits for select to authenticated using (public.can_read_review(review_id));

-- Realtime: broadcast row changes, with the whole old row on DELETE so
-- clients can remove it.
alter table public.text_edits replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'text_edits') then
    alter publication supabase_realtime add table public.text_edits;
  end if;
end $$;
