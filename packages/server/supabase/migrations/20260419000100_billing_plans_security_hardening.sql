-- ============================================================
-- Address linter findings from 20260419000000_billing_plans:
--
--   1. `stripe_processed_events` had RLS enabled with no policies. While the
--      lack of policies already blocks anon/authenticated access (RLS deny-by
--      default), the linter flags this as ambiguous. Add an explicit
--      `USING(false)` policy so intent is unambiguous in the schema dump and
--      the linter clears.
--   2. `prune_stripe_processed_events()` had a mutable `search_path` which
--      lets a search-path-poisoning attacker shadow the `stripe_processed_events`
--      table reference. Pin it to `pg_catalog, public` and mark
--      `SECURITY INVOKER` so the function still runs with the caller's RLS.
-- ============================================================

DROP POLICY IF EXISTS stripe_processed_events_no_public_access ON stripe_processed_events;
CREATE POLICY stripe_processed_events_no_public_access
  ON stripe_processed_events
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY stripe_processed_events_no_public_access ON stripe_processed_events IS
  'Explicit deny for anon/authenticated. Only the service_role (which bypasses RLS) reads/writes this idempotency ledger from the stripe-webhooks Edge Function.';

CREATE OR REPLACE FUNCTION prune_stripe_processed_events()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  DELETE FROM stripe_processed_events
  WHERE processed_at < now() - interval '30 days'
$$;
