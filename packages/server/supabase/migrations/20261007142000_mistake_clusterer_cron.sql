/*
FILE: 20261007142000_mistake_clusterer_cron.sql
PURPOSE: Give mistake-clusterer a working "unclustered embeddings" read and
         schedule it hourly.

OVERVIEW:
- mistake-clusterer's header says it runs on a cron, but no migration ever
  scheduled it and cron.job had no row for it (checked 2026-10-07). With 44
  report embeddings, report_cluster_membership had 0 rows: real bug clusters
  never formed, so lessons only came from seeded data.
- Scheduling it alone would not have helped. Its first read passed a query
  builder to .not('report_id', 'in', ...), which supabase-js turns into the
  filter `not.in.[object Object]`, so every run would 500. The function now
  calls public.mistake_clusterer_unclustered() below instead.
- Hourly at :43. The coherence judge (LLM) runs when the UTC hour is 0, 6, 12
  or 18, so an hourly cadence runs it exactly once per 6-hour window, as the
  function intends. The 15-minute cadence in its old header would have run
  the judge four times per window over the same candidates. :43 is clear of
  every other job's minute.

NOTES:
- Additive and idempotent: CREATE OR REPLACE for the function,
  cron.schedule with an existing name replaces that job, and the schedule is
  skipped when pg_cron is absent (local supabase start, CI).
- The function is SECURITY INVOKER and only service_role may execute it;
  EXECUTE is revoked from public, anon and authenticated explicitly, because
  default privileges grant it to new functions.
- One row per report: a report with embeddings from two models is clustered
  once, with its newest embedding.

VERIFY after apply (one real run, not just the 200):
  select count(*) from public.mistake_clusterer_unclustered(200);
  select mushi.cron_http_post('mistake-clusterer', '{}'::jsonb, 60000);
  -- a minute later:
  select count(*) from public.report_cluster_membership;
  select status, return_message, start_time from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'mushi-mistake-clusterer-hourly')
   order by start_time desc limit 3;
*/

create or replace function public.mistake_clusterer_unclustered(p_limit integer default 200)
returns table (report_id uuid, embedding text, project_id uuid, severity text)
language sql
stable
security invoker
set search_path = public
as $fn$
  select u.report_id, u.embedding, u.project_id, u.severity
    from (
      select distinct on (re.report_id)
             re.report_id,
             re.embedding::text as embedding,
             r.project_id,
             r.severity,
             re.created_at
        from public.report_embeddings re
        join public.reports r on r.id = re.report_id
       where not exists (
               select 1
                 from public.report_cluster_membership m
                where m.report_id = re.report_id
             )
       order by re.report_id, re.created_at desc
    ) u
   order by u.created_at asc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$fn$;

comment on function public.mistake_clusterer_unclustered(integer) is
  'Report embeddings with no report_cluster_membership row, oldest first, one per report. Read by the mistake-clusterer edge function.';

revoke all on function public.mistake_clusterer_unclustered(integer) from public, anon, authenticated;
grant execute on function public.mistake_clusterer_unclustered(integer) to service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-mistake-clusterer-hourly schedule';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'mushi-mistake-clusterer-hourly',
    '43 * * * *',
    $cmd$select mushi.cron_http_post('mistake-clusterer', jsonb_build_object('trigger', 'cron'), 60000);$cmd$
  );
END $$;
