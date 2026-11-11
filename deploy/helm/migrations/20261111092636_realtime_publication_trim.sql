-- Trim the supabase_realtime publication to tables a client listens to
-- (2026-11-11 cost audit). Realtime decodes the WAL of every published table
-- whether or not anyone subscribes; its WAL polling was the most expensive
-- statement on the database (124 min in 11 days).
--
-- No client subscribes to these (apps/admin, apps/testers and every SDK were
-- searched for postgres_changes on them; realtime.subscription agrees):
--   bug_ontology, fix_verifications, integration_health_history (about 3.5k
--   writes a day), prompt_versions, report_groups, tester_balances,
--   tester_credit_ledger, tester_submissions.
-- cron_runs (about 14k writes a day, every cron tick) fed only the console's
-- Health page, which now re-reads it every minute while visible
-- (apps/admin/src/lib/useVisiblePolling.ts). It also stops Realtime from
-- sending cron_runs DELETE events, which skip RLS.

do $$
declare
  t text;
begin
  foreach t in array array[
    'bug_ontology',
    'cron_runs',
    'fix_verifications',
    'integration_health_history',
    'prompt_versions',
    'report_groups',
    'tester_balances',
    'tester_credit_ledger',
    'tester_submissions'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$$;
