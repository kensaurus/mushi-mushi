-- ============================================================
-- Billing tier rollout — Hobby / Starter / Pro / Enterprise.
--
-- Companion to `scripts/stripe-bootstrap.mjs` which provisions the matching
-- Stripe Products + Prices + Billing Meters. This migration:
--
--   1. Adds a `pricing_plans` catalog the server reads to make quota /
--      checkout / overage decisions (single source of truth — the marketing
--      page, the admin /billing UI, and the gateway all read from here).
--   2. Adds `plan_id` + `seat_limit` columns to `billing_subscriptions` so
--      a row knows which tier it belongs to without a Stripe round-trip.
--   3. Adds `stripe_processed_events` for webhook idempotency (Stripe sends
--      duplicate events under load — we MUST guarantee single-processing).
--   4. Adds `fixes_succeeded` to the `usage_events.event_name` enum so the
--      fix-worker can record a value-based meter event when a PR is merged.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. pricing_plans — catalog read by API + UI
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_plans (
  id                          TEXT PRIMARY KEY,                                -- 'hobby' | 'starter' | 'pro' | 'enterprise'
  display_name                TEXT NOT NULL,
  position                    INT NOT NULL,                                    -- sort order on the pricing page
  monthly_price_usd           NUMERIC(10,2) NOT NULL DEFAULT 0,                -- 0 for hobby + enterprise (sales)
  base_price_lookup_key       TEXT,                                            -- Stripe Price lookup_key for the flat fee (NULL = no Stripe price)
  overage_price_lookup_key    TEXT,                                            -- Stripe Price lookup_key for the metered overage (NULL = no overage)
  included_reports_per_month  BIGINT,                                          -- NULL = unlimited
  overage_unit_amount_decimal NUMERIC(10,4),                                   -- $ per report past the included quota; NULL when no overage
  retention_days              INT NOT NULL DEFAULT 7,                          -- audit + report retention
  seat_limit                  INT,                                             -- NULL = unlimited
  is_self_serve               BOOLEAN NOT NULL DEFAULT TRUE,                   -- false for enterprise (sales-led)
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  feature_flags               JSONB NOT NULL DEFAULT '{}'::jsonb,              -- { "sso": true, "byok": true, "sla_hours": 8, … }
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_plans_base_lookup
  ON pricing_plans (base_price_lookup_key)
  WHERE base_price_lookup_key IS NOT NULL;

-- Catalog seed. Lookup keys must match `scripts/stripe-bootstrap.mjs`.
-- `feature_flags` is a JSONB so we can extend without another migration.
INSERT INTO pricing_plans
  (id, display_name, position, monthly_price_usd,
   base_price_lookup_key, overage_price_lookup_key,
   included_reports_per_month, overage_unit_amount_decimal,
   retention_days, seat_limit, is_self_serve, feature_flags)
VALUES
  ('hobby',      'Hobby',      0,    0.00, NULL,                              NULL,                                  1000,    NULL,   7,  3,    TRUE,
   '{"sso":false,"byok":false,"plugins":false,"sla_hours":null,"audit_log":false,"intelligence_reports":false}'::jsonb),
  ('starter',    'Starter',    1,   19.00, 'mushi:starter:base:v1',           'mushi:reports:overage:starter:v1',   10000,   0.0025,  30, NULL, TRUE,
   '{"sso":false,"byok":true,"plugins":true,"sla_hours":48,"audit_log":true,"intelligence_reports":false}'::jsonb),
  ('pro',        'Pro',        2,   99.00, 'mushi:pro:base:v1',               'mushi:reports:overage:pro:v1',       50000,   0.0020,  90, NULL, TRUE,
   '{"sso":true,"byok":true,"plugins":true,"sla_hours":8,"audit_log":true,"intelligence_reports":true}'::jsonb),
  ('enterprise', 'Enterprise', 3,    0.00, NULL,                              NULL,                                  NULL,    NULL,   365, NULL, FALSE,
   '{"sso":true,"byok":true,"plugins":true,"sla_hours":4,"audit_log":true,"intelligence_reports":true,"self_hosted":true,"soc2":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  display_name                = EXCLUDED.display_name,
  position                    = EXCLUDED.position,
  monthly_price_usd           = EXCLUDED.monthly_price_usd,
  base_price_lookup_key       = EXCLUDED.base_price_lookup_key,
  overage_price_lookup_key    = EXCLUDED.overage_price_lookup_key,
  included_reports_per_month  = EXCLUDED.included_reports_per_month,
  overage_unit_amount_decimal = EXCLUDED.overage_unit_amount_decimal,
  retention_days              = EXCLUDED.retention_days,
  seat_limit                  = EXCLUDED.seat_limit,
  is_self_serve               = EXCLUDED.is_self_serve,
  feature_flags               = EXCLUDED.feature_flags,
  updated_at                  = now();

ALTER TABLE pricing_plans ENABLE ROW LEVEL SECURITY;

-- Plans are public catalog data. Any authenticated user (or anon, for the
-- marketing page) can read them; only the service role can write.
DROP POLICY IF EXISTS pricing_plans_read_all ON pricing_plans;
CREATE POLICY pricing_plans_read_all ON pricing_plans
  FOR SELECT TO anon, authenticated USING (true);

-- ----------------------------------------------------------------
-- 2. billing_subscriptions — link to pricing_plans
-- ----------------------------------------------------------------
ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES pricing_plans(id);

ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS overage_subscription_item_id TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_subs_plan ON billing_subscriptions (plan_id);

-- ----------------------------------------------------------------
-- 3. stripe_processed_events — webhook idempotency
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_processed_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Old rows are useless — purge anything older than 30 days nightly. (The
-- pg_cron schedule for this lives alongside the other recovery jobs in
-- 20260418005900_pipeline_recovery_cron.sql; we keep the function here so
-- the migration is self-contained.)
CREATE OR REPLACE FUNCTION prune_stripe_processed_events()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM stripe_processed_events
  WHERE processed_at < now() - interval '30 days'
$$;

ALTER TABLE stripe_processed_events ENABLE ROW LEVEL SECURITY;
-- No SELECT policy — only the service role (Stripe webhook) reads/writes.

-- ----------------------------------------------------------------
-- 4. usage_events — allow `fixes_succeeded` for value-based pricing
-- ----------------------------------------------------------------
ALTER TABLE usage_events
  DROP CONSTRAINT IF EXISTS usage_events_event_name_check;

ALTER TABLE usage_events
  ADD CONSTRAINT usage_events_event_name_check
  CHECK (event_name IN ('reports_ingested', 'fixes_attempted', 'fixes_succeeded', 'classifier_tokens'));

-- ----------------------------------------------------------------
-- 5. fix_attempts.merged_at — set by the GitHub PR-merged webhook
--    so the PDCA cockpit + intelligence reports can show the
--    "successful fixes" count straight from this table without
--    chasing GitHub's API on every render.
-- ----------------------------------------------------------------
ALTER TABLE fix_attempts
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fix_attempts_merged
  ON fix_attempts (project_id, merged_at)
  WHERE merged_at IS NOT NULL;

-- We rely on a single fix_attempt per pr_url for the webhook idempotency
-- check + the FE de-dup logic. Add a partial unique index to enforce it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fix_attempts_pr_url
  ON fix_attempts (pr_url)
  WHERE pr_url IS NOT NULL;

-- ----------------------------------------------------------------
-- Comments — surface intent in psql / PostgREST introspection
-- ----------------------------------------------------------------
COMMENT ON TABLE pricing_plans IS
  'Catalog of self-serve + sales-led tiers. Single source of truth read by the gateway, the admin /billing UI, and the marketing /pricing page.';
COMMENT ON COLUMN pricing_plans.feature_flags IS
  'JSONB feature gate map: { sso, byok, plugins, sla_hours, audit_log, intelligence_reports, self_hosted, soc2, ... }';
COMMENT ON TABLE stripe_processed_events IS
  'Webhook idempotency ledger — every event Stripe POSTs to /stripe-webhooks is INSERT … ON CONFLICT DO NOTHING into this table before being processed. Prevents duplicate processing under retry storms.';
COMMENT ON COLUMN billing_subscriptions.plan_id IS
  'FK to pricing_plans.id. Set by the stripe-webhooks handler from the subscription line items'' lookup_keys.';
COMMENT ON COLUMN billing_subscriptions.overage_subscription_item_id IS
  'Stripe SubscriptionItem ID for the metered overage line. Required for legacy usage_records pushes; in the meter-events flow we just need the customer ID, but storing this lets us detach/reattach the meter cleanly.';
