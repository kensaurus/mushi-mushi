-- =============================================================================
-- PDCA full-sweep .3: hourly repo indexer sweep.
--
-- The webhooks-github-indexer function only re-indexes a repo on push events.
-- Projects that haven't pushed (or that never installed the GitHub App) end up
-- with empty RAG, which is why fix-worker writes INVESTIGATION_NEEDED.md
-- instead of patching real files. This migration:
--
--   1. Adds `project_repos.last_indexed_at` so the sweep can pick the stalest
--      repos first.
--   2. Schedules `mushi-repo-indexer-hourly` via pg_cron, which POSTs to the
--      indexer with `{ "mode": "sweep" }`. The indexer iterates over enabled
--      project_repos and re-indexes any older than 24h.
--
-- Idempotent: ALTER ... IF NOT EXISTS, drop-and-recreate of the cron job.
-- =============================================================================

alter table project_repos
  add column if not exists last_indexed_at      timestamptz,
  add column if not exists indexing_enabled     boolean default true,
  add column if not exists last_index_error     text,
  add column if not exists last_index_attempt_at timestamptz;

create index if not exists idx_project_repos_indexing_due
  on project_repos(last_indexed_at nulls first)
  where indexing_enabled = true;

comment on column project_repos.last_indexed_at is
  'Last successful sweep-mode index. NULL = never indexed.';
comment on column project_repos.indexing_enabled is
  'When false, the hourly sweep skips this repo. Webhook ingestion still works.';

-- ----------------------------------------------------------------------------
-- Cron schedule: registered only if pg_cron is installed.
-- Mirror of the wrapper in 20260417000000_telemetry_and_realtime.sql.
-- ----------------------------------------------------------------------------
do $$
declare
  has_cron boolean;
begin
  select exists (select 1 from pg_namespace where nspname = 'cron') into has_cron;
  if not has_cron then
    raise notice 'pg_cron not installed; skipping repo-indexer cron registration';
    return;
  end if;

  perform cron.unschedule(jobname)
    from cron.job
   where jobname = 'mushi-repo-indexer-hourly';

  perform cron.schedule(
    'mushi-repo-indexer-hourly',
    '17 * * * *',
    $cron$
      select net.http_post(
        url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/webhooks-github-indexer',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
          'X-Mushi-Internal', 'sweep'
        ),
        body    := jsonb_build_object('mode', 'sweep')
      );
    $cron$
  );
end $$;
