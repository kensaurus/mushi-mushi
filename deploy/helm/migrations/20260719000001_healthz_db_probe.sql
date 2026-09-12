-- Migration: healthz DB probe helper
-- Adds a lightweight RPC that the /healthz edge function uses to confirm
-- database connectivity without accessing any user data.
--
-- Returns the current epoch in milliseconds — a trivial probe that exercises
-- the full query path (connection pool → plpgsql execution → result serialisation)
-- without touching any table or leaking data.
--
-- The function is granted to the service_role only (the healthz function always
-- runs with the service client). Anon/authenticated callers cannot invoke it.

CREATE OR REPLACE FUNCTION public.get_db_epoch_ms()
  RETURNS bigint
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
AS $$
  SELECT EXTRACT(EPOCH FROM clock_timestamp())::bigint * 1000;
$$;

-- Revoke from all roles first, then grant explicitly to service_role only
REVOKE ALL ON FUNCTION public.get_db_epoch_ms() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_db_epoch_ms() FROM anon;
REVOKE ALL ON FUNCTION public.get_db_epoch_ms() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_db_epoch_ms() TO service_role;

COMMENT ON FUNCTION public.get_db_epoch_ms() IS
  'Lightweight healthz probe — returns current epoch ms. Callable by service_role only.';
