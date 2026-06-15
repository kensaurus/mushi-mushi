-- Harden reporter helper functions + close GraphQL exposure on service-only tables.
--
-- 1. mushi_ensure_feature_ticket / mushi_apply_reporter_feedback are SECURITY DEFINER
--    and only ever invoked by service-role edge routes (reporter-feature-board.ts,
--    public.ts reporter verify/reopen). Supabase's default privileges grant EXECUTE
--    to anon/authenticated at creation time, which a bare `REVOKE ... FROM PUBLIC`
--    does NOT remove. Without this, anon/authenticated could call them directly via
--    /rest/v1/rpc and bypass reporter-token verification (e.g. spam feature tickets
--    for any project, or apply feedback to arbitrary reports).
--    Advisors: anon_security_definer_function_executable /
--    authenticated_security_definer_function_executable.
--
-- 2. jwks_cache / pipeline_runs received deny-all RLS in
--    20260615150000_console_dx_enhancement.sql but SELECT was never revoked from
--    anon/authenticated, so they stayed visible in the auto-generated GraphQL
--    introspection schema. RLS already blocks the rows; revoking SELECT also
--    removes the tables from the public API surface.
--    Advisors: pg_graphql_anon_table_exposed / pg_graphql_authenticated_table_exposed.
--
-- Idempotent: REVOKE is a no-op when the grant is already absent.

DO $$
BEGIN
  IF to_regprocedure('public.mushi_ensure_feature_ticket(uuid, text, text, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.mushi_ensure_feature_ticket(uuid, text, text, text) FROM anon, authenticated;
  END IF;
  IF to_regprocedure('public.mushi_apply_reporter_feedback(uuid, text, text, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.mushi_apply_reporter_feedback(uuid, text, text, text) FROM anon, authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.jwks_cache') IS NOT NULL THEN
    REVOKE SELECT ON public.jwks_cache FROM anon, authenticated;
  END IF;
  IF to_regclass('public.pipeline_runs') IS NOT NULL THEN
    REVOKE SELECT ON public.pipeline_runs FROM anon, authenticated;
  END IF;
END $$;
