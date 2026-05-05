-- Enable inventory_v2 (bidirectional graph + gates) for Pro+ tiers.
-- Hobby/Starter remain negative-graph–only per whitepaper §7.

UPDATE pricing_plans
SET feature_flags = feature_flags || '{"inventory_v2": true}'::jsonb,
    updated_at = now()
WHERE id IN ('pro', 'enterprise');

UPDATE pricing_plans
SET feature_flags = feature_flags || '{"inventory_v2": false}'::jsonb,
    updated_at = now()
WHERE id IN ('hobby', 'starter')
  AND (feature_flags->>'inventory_v2') IS NULL;
