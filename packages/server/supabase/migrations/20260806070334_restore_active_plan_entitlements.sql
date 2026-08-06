-- Restore the active diagnosis-metered plan catalog after
-- 20260621095240_diagnoses_billing_tiers replaced each feature_flags object.
--
-- Feature flags are an extensible map. Replacing the whole JSONB value erased
-- previously shipped entitlements (including BYOK) and made those features
-- unreachable on every active plan. Merge the canonical tier flags instead so
-- unrelated and future keys remain intact.
--
-- The diagnoses migration introduced Free Cloud / Indie at positions 10 / 11
-- but left Pro / Enterprise at 2 / 3. Keep the active catalog contiguous in
-- ascending upgrade order without colliding with inactive Hobby / Starter.

UPDATE public.pricing_plans
SET
  position = CASE id
    WHEN 'free_cloud' THEN 10
    WHEN 'indie' THEN 11
    WHEN 'pro' THEN 12
    WHEN 'enterprise' THEN 13
  END,
  feature_flags = COALESCE(feature_flags, '{}'::jsonb) ||
    CASE id
      WHEN 'free_cloud' THEN '{
        "sso": false,
        "byok": false,
        "plugins": false,
        "sla_hours": null,
        "audit_log": false,
        "intelligence_reports": false,
        "self_hosted": false,
        "soc2": false,
        "teams": false,
        "inventory_v2": false,
        "rewards_program": false,
        "rewards_monetary": false,
        "marketplace_publish": false,
        "tester_cashout": false,
        "marketplace_priority_listing": false
      }'::jsonb
      WHEN 'indie' THEN '{
        "sso": false,
        "byok": true,
        "plugins": true,
        "sla_hours": 48,
        "audit_log": true,
        "intelligence_reports": false,
        "self_hosted": false,
        "soc2": false,
        "teams": false,
        "inventory_v2": false,
        "rewards_program": true,
        "rewards_monetary": false,
        "marketplace_publish": false,
        "tester_cashout": false,
        "marketplace_priority_listing": false
      }'::jsonb
      WHEN 'pro' THEN '{
        "sso": false,
        "byok": true,
        "plugins": true,
        "sla_hours": 8,
        "audit_log": true,
        "intelligence_reports": true,
        "self_hosted": false,
        "soc2": false,
        "teams": true,
        "inventory_v2": true,
        "rewards_program": true,
        "rewards_monetary": false,
        "marketplace_publish": true,
        "tester_cashout": true,
        "marketplace_priority_listing": false
      }'::jsonb
      WHEN 'enterprise' THEN '{
        "sso": true,
        "byok": true,
        "plugins": true,
        "sla_hours": 4,
        "audit_log": true,
        "intelligence_reports": true,
        "self_hosted": true,
        "soc2": true,
        "teams": true,
        "inventory_v2": true,
        "rewards_program": true,
        "rewards_monetary": true,
        "marketplace_publish": true,
        "tester_cashout": true,
        "marketplace_priority_listing": true
      }'::jsonb
    END,
  updated_at = now()
WHERE id IN ('free_cloud', 'indie', 'pro', 'enterprise');

COMMENT ON COLUMN public.pricing_plans.feature_flags IS
  'Extensible entitlement map. Migrations must merge keys with jsonb || or jsonb_set; never replace the whole object.';
