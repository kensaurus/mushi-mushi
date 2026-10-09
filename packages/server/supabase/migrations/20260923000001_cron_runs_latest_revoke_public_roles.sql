-- cron_runs_latest (20260923000000) was created with the schema's default
-- privileges, which hand every table privilege on a new public object to anon
-- and authenticated. The view is security_invoker and cron_runs has RLS with no
-- anon SELECT, so nothing leaked, but the view was discoverable in the GraphQL
-- schema (linter 0026) and authenticated could read it directly. Only the API's
-- service client reads it (routes/health.ts), so scope it to service_role.
revoke all on public.cron_runs_latest from anon, authenticated;
grant select on public.cron_runs_latest to service_role;
