-- Settings for a self-hosted install, written after every migration run by
-- deploy/selfhost/migrate/migrate.sh. Safe to re-run.
--
-- psql variables: functions_url, secret, plan_limits ('on' keeps hosted caps).

-- The database's scheduled jobs (pg_cron + pg_net) call edge functions at
-- <supabase_url>/functions/v1/<name> with this bearer token. The migrations seed
-- the hosted project's URL; a self-hosted install must call itself.
insert into public.mushi_runtime_config (key, value) values
  ('supabase_url', :'functions_url'),
  ('internal_caller_token', :'secret'),
  ('service_role_key', :'secret')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Hosted plans cap diagnoses per month because Mushi pays for the model calls.
-- A self-hoster pays their own model provider, so no caps (NULL = unlimited).
select set_config('mushi.plan_limits', :'plan_limits', false);
do $$
begin
  if current_setting('mushi.plan_limits') <> 'on' then
    update public.pricing_plans
       set included_reports_per_month = null,
           included_diagnoses_per_month = null;
  end if;
end $$;
