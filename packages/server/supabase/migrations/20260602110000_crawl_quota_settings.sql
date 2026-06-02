-- Add configurable per-project crawl and TDD generation quotas to project_settings.
-- Defaults are generous enough for normal usage while preventing runaway spend.

alter table public.project_settings
  add column if not exists crawl_max_pages_per_day int not null default 150,
  add column if not exists crawl_max_runs_per_day  int not null default 8,
  add column if not exists tdd_max_gens_per_day    int not null default 20;

comment on column public.project_settings.crawl_max_pages_per_day is
  'Max Firecrawl pages consumed by live-crawl story-mapping per UTC day.';
comment on column public.project_settings.crawl_max_runs_per_day is
  'Max live-crawl map runs initiated per UTC day.';
comment on column public.project_settings.tdd_max_gens_per_day is
  'Max TDD test files generated (test-gen-from-story) per UTC day.';
