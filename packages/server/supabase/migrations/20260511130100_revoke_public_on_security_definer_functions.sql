-- FILE: 20260511130100_revoke_public_on_security_definer_functions.sql
--
-- The earlier migration (20260511120500) used `REVOKE FROM anon` which only
-- removes an explicit anon grant. These SECURITY DEFINER functions were
-- granted to PUBLIC (the `=X/postgres` ACL entry), which all roles inherit.
-- The correct fix is `REVOKE FROM PUBLIC`, which removes the inherited grant
-- without touching the explicit grants to `authenticated`, `service_role`,
-- and `postgres` that are still needed.
--
-- Functions intentionally left with public/anon access:
--   • accept_invitation     — called pre-auth by the invitation email link
--   • cleanup_idempotency_keys — called from unauthenticated webhook paths
--   • fn_a2a_push_on_status_change — internal DB trigger, not user-callable
--
-- Approach: loop by OID so type resolution (e.g. extensions.vector for
-- match_fix_corpus) is not an issue. regprocedure::text gives the correct
-- qualified signature for EXECUTE.

DO $$
DECLARE
  r record;
  _exclude text[] := ARRAY[
    'accept_invitation',
    'cleanup_idempotency_keys',
    'fn_a2a_push_on_status_change'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn_sig
    FROM   pg_proc p
    WHERE  p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND  p.prosecdef = true
      AND  p.proacl::text LIKE '%=X%'
      AND  p.proname <> ALL(_exclude)
  LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.fn_sig || ' FROM PUBLIC';
  END LOOP;
END;
$$;
