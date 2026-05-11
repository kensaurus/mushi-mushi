-- FILE: 20260511120300_updated_at_trigger_coverage.sql
--
-- Attaches the existing `set_updated_at` trigger function to every mutable
-- table that has an `updated_at` column but no BEFORE UPDATE trigger.
--
-- Tables covered by this migration:
--   billing_customers, billing_subscriptions, fix_coordinations,
--   mushi_runtime_config, organizations, pricing_plans,
--   project_repos, region_routing
--
-- The function `set_updated_at()` is already present (created by an earlier
-- migration). This migration is purely additive — no behaviour change on
-- tables that already have the trigger.

DO $DO$
DECLARE
  _tables text[] := ARRAY[
    'billing_customers',
    'billing_subscriptions',
    'fix_coordinations',
    'mushi_runtime_config',
    'organizations',
    'pricing_plans',
    'project_repos',
    'region_routing'
  ];
  _t text;
BEGIN
  FOREACH _t IN ARRAY _tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.triggers
      WHERE event_object_schema = 'public'
        AND event_object_table  = _t
        AND trigger_name        LIKE '%updated_at%'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%s_updated_at
           BEFORE UPDATE ON public.%I
           FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()',
        _t, _t
      );
    END IF;
  END LOOP;
END;
$DO$;
