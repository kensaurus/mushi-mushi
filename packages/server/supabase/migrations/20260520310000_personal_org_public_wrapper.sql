-- ============================================================
-- Public RPC wrapper for private.bootstrap_personal_org.
--
-- PostgREST only exposes schemas listed in `api.schemas` (config.toml /
-- Supabase Studio API settings). The mushi-mushi project keeps this list
-- at the default `public,graphql_public` so the `private` schema is
-- intentionally invisible to the public Data API. supabase-js's
-- `.schema('private').rpc(...)` call would 404 against that.
--
-- The api edge function uses the service-role key and could in theory
-- bypass this via direct SQL, but we want a one-liner that works through
-- the existing `db.rpc(...)` plumbing (and matches every other RPC call
-- the function already makes). A thin SECURITY DEFINER wrapper in
-- `public` is the canonical Supabase pattern for that.
--
-- The wrapper is restricted to `service_role` because (a) only the
-- backend should be minting personal orgs for arbitrary user ids and
-- (b) the underlying private function already enforces idempotency, but
-- exposing it to authenticated would let a logged-in user claim a
-- personal org for ANY user id they pass — clearly not what we want.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bootstrap_personal_org(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN private.bootstrap_personal_org(p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_personal_org(uuid) FROM public;
REVOKE ALL ON FUNCTION public.bootstrap_personal_org(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.bootstrap_personal_org(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_personal_org(uuid) TO service_role;

COMMENT ON FUNCTION public.bootstrap_personal_org(uuid) IS
  'Service-role only PostgREST entry-point for private.bootstrap_personal_org. The wrapper exists because PostgREST does not expose the `private` schema by default — the wrapper lets the api edge function call this through the standard db.rpc() plumbing without needing to widen the schema allowlist.';
