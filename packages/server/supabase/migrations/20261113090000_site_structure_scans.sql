-- Journey optimizer (ADR 0058): the site scans behind the site map.
--
-- One row per scan of an app's live site (api/routes/journeys.ts): Firecrawl
-- maps the site and reads up to 40 pages, no LLM. `pages` keeps, per page,
-- its path, URL, title, internal links (as paths), a word count and a
-- 64-slot MinHash of its own content — never the page text itself.
-- The API keeps the newest 10 scans per app. Service role only: the console
-- reads scans through the API, which checks app access.

create table if not exists public.site_structure_scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  base_url text not null check (char_length(base_url) <= 500),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  page_count integer not null default 0 check (page_count >= 0),
  pages jsonb not null default '[]'::jsonb check (jsonb_typeof(pages) = 'array'),
  error text check (char_length(error) <= 500),
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists site_structure_scans_project_created
  on public.site_structure_scans (project_id, created_at desc);

create index if not exists site_structure_scans_requested_by
  on public.site_structure_scans (requested_by)
  where requested_by is not null;

alter table public.site_structure_scans enable row level security;
revoke all on public.site_structure_scans from anon, authenticated;

comment on table public.site_structure_scans is
  'Journey optimizer site scans (ADR 0058): per page path, title, internal links, word count and a MinHash of its content. Written and read by api-ext journeys routes. Service role only.';
