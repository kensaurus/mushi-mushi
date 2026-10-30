-- "Decide for me" (ADR 0055): Mushi queues Opus-approved fix PRs and closes
-- the ones Opus will not merge, for apps that turn it on. Off by default.
alter table public.project_settings
  add column if not exists auto_decide_enabled boolean not null default false;

comment on column public.project_settings.auto_decide_enabled is
  'Decide for me (ADR 0055): the merge-queue worker queues Opus-approved fix PRs and closes held ones without a person.';

-- When the worker last read this PR from GitHub, so each tick takes the
-- PRs looked at longest ago and never re-reads one within 20 minutes.
alter table public.fix_attempts
  add column if not exists auto_decide_checked_at timestamptz;

create index if not exists fix_attempts_auto_decide_open_idx
  on public.fix_attempts (project_id, auto_decide_checked_at nulls first)
  where pr_url is not null and merged_at is null;
