/*
FILE: 20261016140000_sdk_upgrade_reaper_execute_grants.sql
PURPOSE: Only pg_cron and the service role may run sdk_upgrade_jobs_stuck_reaper().

OVERVIEW:
- 20260828100000 created the reaper as SECURITY DEFINER. Default privileges
  gave anon and authenticated EXECUTE, so any REST caller could run it.
- Match fix_attempts_stuck_reaper: service_role and postgres only.
- Applied to production 2026-10-16 together with 20260828100000 (BL-060).
*/

REVOKE EXECUTE ON FUNCTION public.sdk_upgrade_jobs_stuck_reaper() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sdk_upgrade_jobs_stuck_reaper() TO service_role;
