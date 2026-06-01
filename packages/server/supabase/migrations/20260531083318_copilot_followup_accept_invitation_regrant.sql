-- Migration: copilot_followup_accept_invitation_regrant
-- Deployed: 2026-05-31 via Supabase MCP (apply_migration)
-- Reason: Copilot PR #144 fix — migration 20260526151243 over-revoked EXECUTE
--   on accept_invitation(text) from authenticated. The function is called via
--   getUserClient(authHeader).rpc('accept_invitation', ...) in
--   packages/server/supabase/functions/api/routes/organizations.ts,
--   which uses the caller's JWT (authenticated role). Without this GRANT the
--   invitation-accept flow returns 42501 (insufficient_privilege).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'accept_invitation'
      AND pg_get_function_identity_arguments(p.oid) = 'p_token text'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
