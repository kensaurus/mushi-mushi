-- Migration: tester_redemptions_and_kyc
-- PURPOSE: Wave 1 — the redemption rails (closed-loop Pro credit + Tremendous
--   gift cards) and the KYC / sanctions tables.

-- ── tester_redemptions ────────────────────────────────────────────────────
-- Each row is one redemption request. Closed-loop kinds (mushi_pro_credit,
-- app_slot, api_quota) complete synchronously. Gift-card kinds create a
-- corresponding tremendous_orders row and complete asynchronously via the
-- tremendous-redemption-worker cron.
CREATE TABLE IF NOT EXISTS public.tester_redemptions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tester_id             uuid        NOT NULL REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  kind                  text        NOT NULL
                          CHECK (kind IN (
                            'mushi_pro_credit', 'gift_card', 'app_slot', 'api_quota'
                          )),
  points_spent          int         NOT NULL CHECK (points_spent > 0),
  face_value_usd        numeric     CHECK (face_value_usd > 0),
  -- premium_multiplier = 1.3 for mushi_pro_credit, 1.0 for gift_card.
  -- Stored for audit: proves which rate was applied at redemption time.
  premium_multiplier    numeric     NOT NULL DEFAULT 1.0,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  processed_at          timestamptz,
  status                text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending', 'processing', 'complete', 'failed',
                            'reversed', 'withheld'
                          )),
  -- tremendous_order_id set after the worker submits to Tremendous.
  tremendous_order_id   text,
  failure_reason        text,
  withheld_reason       text,
  idempotency_key       text        UNIQUE NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER tester_redemptions_updated_at
  BEFORE UPDATE ON public.tester_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_tester_redemptions_tester
  ON public.tester_redemptions (tester_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_tester_redemptions_pending
  ON public.tester_redemptions (status, requested_at)
  WHERE status = 'pending';

ALTER TABLE public.tester_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tester_redemptions_self_read ON public.tester_redemptions
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

-- Now add the FK from tester_credit_ledger.redemption_id
-- (the ledger table was created in 20260523003000 without the FK because
-- tester_redemptions didn't exist yet).
ALTER TABLE public.tester_credit_ledger
  ADD CONSTRAINT fk_ledger_redemption
  FOREIGN KEY (redemption_id) REFERENCES public.tester_redemptions(id) ON DELETE SET NULL;

-- ── tester_kyc ────────────────────────────────────────────────────────────
-- KYC / tax-form tracking. Triggered at $400 YTD gift-card redemptions
-- (the in-app threshold; $600 is the IRS legal threshold but $400 gives
-- a buffer for concurrent in-flight redemptions).
-- TIN is NEVER stored in plaintext — only as SHA-256 hash for dedup/sanctions.
CREATE TABLE IF NOT EXISTS public.tester_kyc (
  tester_id               uuid    PRIMARY KEY REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  jurisdiction            text,   -- 'US' | 'non-US-individual' | 'non-US-entity'
  tax_form_kind           text    CHECK (tax_form_kind IN ('W9', 'W8BEN', 'W8BEN-E', 'none')),
  tax_form_collected_at   timestamptz,
  -- SHA-256 of the lowercased TIN (SSN / EIN / ITIN). Raw TIN never stored.
  tin_provided_hash       text,
  -- 'pending' | 'cleared' | 'review' | 'blocked'
  withholding_status      text    NOT NULL DEFAULT 'pending',
  sanctions_screened_at   timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER tester_kyc_updated_at
  BEFORE UPDATE ON public.tester_kyc
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tester_kyc ENABLE ROW LEVEL SECURITY;

-- Testers can read their own KYC status (but not the tin_hash).
CREATE POLICY tester_kyc_self_read ON public.tester_kyc
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

COMMENT ON TABLE public.tester_kyc IS
  'KYC / tax-form status for testers. tax_form_collected_at must be set and '
  'withholding_status must be ''cleared'' before gift-card redemptions proceed. '
  'TIN is stored only as SHA-256 hash — never in plaintext.';

-- ── tremendous_orders ─────────────────────────────────────────────────────
-- One row per Tremendous API order. Status is kept in sync by the
-- tremendous-redemption-worker cron and the /v1/webhooks/tremendous receiver.
CREATE TABLE IF NOT EXISTS public.tremendous_orders (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tester_id             uuid        NOT NULL REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  redemption_id         uuid        NOT NULL REFERENCES public.tester_redemptions(id) ON DELETE CASCADE,
  -- external_id is the Tremendous order ID returned by POST /v2/orders.
  external_id           text        UNIQUE,
  -- status mirrors Tremendous order states: 'pending', 'processing', 'complete', 'failed'.
  status                text        NOT NULL DEFAULT 'pending',
  amount_usd            numeric     NOT NULL CHECK (amount_usd > 0),
  sku                   text,
  -- SHA-256 of the recipient email (never store plaintext email in mushi DB).
  recipient_email_hash  text,
  raw_payload           jsonb,
  last_synced_at        timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tremendous_orders_pending
  ON public.tremendous_orders (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_tremendous_orders_tester
  ON public.tremendous_orders (tester_id, created_at DESC);

ALTER TABLE public.tremendous_orders ENABLE ROW LEVEL SECURITY;

-- Testers can read their own orders.
CREATE POLICY tremendous_orders_self_read ON public.tremendous_orders
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

COMMENT ON TABLE public.tremendous_orders IS
  'One row per Tremendous API order. created by the tester_redemptions handler '
  'when kind=''gift_card''. Status synced by the tremendous-redemption-worker '
  'cron and by POST /v1/webhooks/tremendous HMAC-signed webhook.';
