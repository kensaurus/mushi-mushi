-- =============================================================================
-- Lock down `intelligence_benchmarks_mv` to service_role only.
--
-- The Supabase advisor warns when materialized views are selectable over the
-- PostgREST data APIs. This MV holds aggregate intelligence benchmarks that
-- should only be served via Edge Functions running with the service role.
-- Any client surface that needs this data should hit a server endpoint that
-- enforces tenant scoping itself.
-- =============================================================================

revoke select on public.intelligence_benchmarks_mv from anon, authenticated;
grant select on public.intelligence_benchmarks_mv to service_role;
