-- ============================================================
-- Wave D D5: Stripe metered billing + apps/cloud sign-up
--
-- Three tables back the Cloud product:
--   * `billing_customers`    — 1:1 with Stripe Customer, scoped to project
--   * `billing_subscriptions`— mirror of Stripe Subscription state, used by
--                              gateway to gate access (status='active')
--   * `usage_events`         — append-only meter of billable units
--                              (currently `reports_ingested`). Aggregated
--                              nightly and POSTed to Stripe Meter Events.
--
-- Pricing model = $0.0025 per ingested report after a 1,000-report free
-- tier per month. Plans are flat $0/seat — usage is the only billable
-- dimension. Storage cap remains at 10GB per project / month.
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_customers (
  project_id          UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  stripe_customer_id  TEXT NOT NULL UNIQUE,
  email               TEXT NOT NULL,
  default_payment_ok  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_customers_email ON billing_customers (email);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stripe_subscription_id   TEXT NOT NULL UNIQUE,
  stripe_price_id          TEXT NOT NULL,
  status                   TEXT NOT NULL
    CHECK (status IN ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')),
  current_period_start     TIMESTAMPTZ NOT NULL,
  current_period_end       TIMESTAMPTZ NOT NULL,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_subs_project ON billing_subscriptions (project_id);
CREATE INDEX IF NOT EXISTS idx_billing_subs_status ON billing_subscriptions (status);

CREATE TABLE IF NOT EXISTS usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_name      TEXT NOT NULL CHECK (event_name IN ('reports_ingested','fixes_attempted','classifier_tokens')),
  quantity        BIGINT NOT NULL CHECK (quantity > 0),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  meter_synced_at TIMESTAMPTZ,
  stripe_meter_event_id TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_usage_events_project_event ON usage_events (project_id, event_name, occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_unsynced ON usage_events (event_name, occurred_at) WHERE meter_synced_at IS NULL;

-- ----------------------------------------------------------------
-- RLS — only project members can see their own billing state.
-- Service role (used by Stripe webhooks + sync cron) bypasses RLS.
-- ----------------------------------------------------------------
ALTER TABLE billing_customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events          ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_customers_select_member ON billing_customers
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY billing_subs_select_member ON billing_subscriptions
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY usage_events_select_member ON usage_events
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

-- ----------------------------------------------------------------
-- Helper: aggregate unsynced report ingestion per project per UTC day.
-- The `usage-aggregator` Edge Function calls this nightly.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_usage_unsynced_summary(
  p_event_name TEXT
) RETURNS TABLE (
  project_id  UUID,
  day_utc     DATE,
  total       BIGINT
) LANGUAGE sql STABLE AS $$
  SELECT project_id,
         (occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
         SUM(quantity)::bigint AS total
  FROM usage_events
  WHERE event_name = p_event_name
    AND meter_synced_at IS NULL
  GROUP BY 1, 2
  ORDER BY 1, 2
$$;

COMMENT ON TABLE billing_customers IS 'Wave D D5: 1:1 with Stripe Customer, project-scoped.';
COMMENT ON TABLE billing_subscriptions IS 'Wave D D5: mirror of Stripe Subscription state, drives access gating.';
COMMENT ON TABLE usage_events IS 'Wave D D5: append-only meter of billable units (reports_ingested, fixes_attempted, classifier_tokens).';
