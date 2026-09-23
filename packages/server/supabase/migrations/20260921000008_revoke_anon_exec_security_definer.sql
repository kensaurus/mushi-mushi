-- ============================================================
-- Revoke client EXECUTE on SECURITY DEFINER functions that clients must never
-- call directly.
--
-- Supabase's default privileges grant EXECUTE on new public functions to anon
-- and authenticated explicitly (proacl shows anon=X/authenticated=X), so the
-- earlier revoke migrations, which never named these functions, left them
-- callable through PostgREST with the public anon key:
--
--   fix_dispatch_sweeper()        takes an advisory lock and POSTs to the api
--   fix_attempts_stuck_reaper()   UPDATEs fix_attempts
--   five updated_at trigger helpers (not callable as RPCs, revoked for hygiene;
--   the Supabase security advisor flags all seven)
--
-- Their real callers are pg_cron jobs, which run as the owner, and triggers,
-- which do not check EXECUTE on the trigger function for the caller — neither
-- is affected. service_role keeps its own explicit grant.
--
-- Default privileges are deliberately NOT changed here: revoking EXECUTE from
-- authenticated for all future functions would silently break console RPCs
-- that rely on the default grant. New definer functions should REVOKE in the
-- migration that creates them.
-- ============================================================

revoke execute on function public.fix_dispatch_sweeper() from public, anon, authenticated;
revoke execute on function public.fix_attempts_stuck_reaper() from public, anon, authenticated;
revoke execute on function public._set_organization_integration_settings_updated_at() from public, anon, authenticated;
revoke execute on function public.set_agent_skills_updated_at() from public, anon, authenticated;
revoke execute on function public.set_skill_pipeline_runs_updated_at() from public, anon, authenticated;
revoke execute on function public.set_skill_sources_updated_at() from public, anon, authenticated;
revoke execute on function public.set_skill_step_runs_updated_at() from public, anon, authenticated;
