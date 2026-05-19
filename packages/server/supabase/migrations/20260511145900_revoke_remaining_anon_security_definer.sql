-- FILE: 20260511145900_revoke_remaining_anon_security_definer.sql
--
-- Final straggler-cleanup for anon_security_definer_function_executable
-- after the audit re-scan. Two SECURITY DEFINER functions still inherit
-- EXECUTE from PUBLIC and thus appear callable by `anon`:
--
--   • cleanup_idempotency_keys()        — internal cron-only cleanup
--   • fn_a2a_push_on_status_change()    — internal trigger function
--
-- Trigger functions bypass EXECUTE checks at trigger-fire time, but
-- Supabase's advisor still flags the grant. Revoking from PUBLIC is
-- safe and silences the WARN.
--
-- `accept_invitation(text)` is intentionally left PUBLIC — anonymous
-- users follow invitation links before they sign in.
--
-- SET LOCAL: scoped to this migration's transaction; auto-resets on
-- COMMIT (no manual RESET needed).
SET LOCAL search_path = public;

REVOKE EXECUTE ON FUNCTION public.cleanup_idempotency_keys()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_idempotency_keys()       FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_a2a_push_on_status_change()   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_a2a_push_on_status_change()   FROM anon;

-- Re-grant the roles that *should* still be able to invoke them.
GRANT EXECUTE ON FUNCTION public.cleanup_idempotency_keys()        TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_a2a_push_on_status_change()    TO service_role;
