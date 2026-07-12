-- ============================================================
-- Public RPC wrapper for private.touch_org_member_activity.
--
-- PostgREST only exposes schemas in the `api.schemas` list (config.toml /
-- Studio API settings). The project keeps this list at the default
-- `public,graphql_public`, so the `private` schema is intentionally
-- invisible to the Data API. Supabase JS's `.schema('private').rpc(...)`
-- therefore returns 406 Not Acceptable — not a fatal error (the call is
-- fire-and-forget) but it generates persistent noise in the Postgres logs.
--
-- A thin SECURITY DEFINER wrapper in `public` (same pattern as
-- `bootstrap_personal_org`) lets `auth.ts` call this via the standard
-- `db.rpc('touch_org_member_activity', ...)` path without widening the
-- schema allowlist.
--
-- Access is intentionally restricted to service_role only — this is an
-- internal heartbeat that only the backend should be writing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_org_member_activity(p_org_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM private.touch_org_member_activity(p_org_id, p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.touch_org_member_activity(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.touch_org_member_activity(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.touch_org_member_activity(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.touch_org_member_activity(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.touch_org_member_activity(uuid, uuid) IS
  'Service-role only PostgREST entry-point for private.touch_org_member_activity. '
  'Exists because PostgREST does not expose the private schema by default — '
  'this wrapper lets auth.ts call through db.rpc() without widening the schema allowlist, '
  'eliminating the 406 log noise from the .schema("private").rpc(...) call.';
