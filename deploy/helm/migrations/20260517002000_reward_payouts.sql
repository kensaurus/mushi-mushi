-- Migration: reward_payouts
-- PURPOSE: P2 rewards monetary — payout ledger and Stripe Connect account
--   tracking. `reward_payouts` records each transfer request; `reward_payout_accounts`
--   links end_users to their Stripe Connect Express account.
-- Gated by pricing_plans.feature_flags.rewards_monetary.

-- ── reward_payout_accounts ────────────────────────────────────────────
-- One row per end_user. Stores their Stripe Connect Express account so
-- we can issue transfers. KYC state tracked here.
CREATE TABLE IF NOT EXISTS public.reward_payout_accounts (
  end_user_id               uuid        PRIMARY KEY REFERENCES public.end_users(id) ON DELETE CASCADE,
  stripe_connect_account_id text        NOT NULL,
  kyc_status                text        NOT NULL DEFAULT 'pending'
                              CHECK (kyc_status IN ('pending', 'in_progress', 'complete', 'failed', 'restricted')),
  kyc_completed_at          timestamptz NULL,
  onboarding_url_expires_at timestamptz NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER reward_payout_accounts_updated_at
  BEFORE UPDATE ON public.reward_payout_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_payout_accounts_stripe
  ON public.reward_payout_accounts (stripe_connect_account_id);

ALTER TABLE public.reward_payout_accounts ENABLE ROW LEVEL SECURITY;

-- Service role only; end-users never query this table directly via SDK
CREATE POLICY "service role only: reward_payout_accounts"
  ON public.reward_payout_accounts
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- ── reward_payouts ────────────────────────────────────────────────────
-- Append-only ledger: one row per payout request. Aggregator cron
-- processes rows in status = 'pending', sets stripe_transfer_id on success.
CREATE TABLE IF NOT EXISTS public.reward_payouts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  end_user_id           uuid        NOT NULL REFERENCES public.end_users(id) ON DELETE CASCADE,
  organization_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  amount_usd            numeric(10,4) NOT NULL CHECK (amount_usd > 0),
  currency              text        NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  tier_slug             text        NULL,
  stripe_transfer_id    text        NULL,
  stripe_failure_code   text        NULL,
  status                text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled', 'withheld')),
  -- withheld = anti-fraud gate fired; amount frozen pending review
  withheld_reason       text        NULL,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz NULL,
  paid_at               timestamptz NULL,
  idempotency_key       text        UNIQUE NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER reward_payouts_updated_at
  BEFORE UPDATE ON public.reward_payouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_reward_payouts_end_user
  ON public.reward_payouts (end_user_id);

CREATE INDEX IF NOT EXISTS idx_reward_payouts_org
  ON public.reward_payouts (organization_id);

CREATE INDEX IF NOT EXISTS idx_reward_payouts_status
  ON public.reward_payouts (status)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.reward_payouts ENABLE ROW LEVEL SECURITY;

-- Service role only; monetary data never exposed to client JWT
CREATE POLICY "service role only: reward_payouts"
  ON public.reward_payouts
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- ── Org-level monthly budget cap column ───────────────────────────────
-- Add to reward_org_settings or project_settings if needed; for now store
-- as a column on the reward_webhooks table to keep single-table simplicity.
-- We add a JSON column to project_settings for the payout budget.
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS rewards_monthly_payout_budget_usd numeric(10,2) NULL;

-- ── Comments ──────────────────────────────────────────────────────────
COMMENT ON TABLE public.reward_payout_accounts IS
  'P2 Rewards monetary: Stripe Connect Express account per end_user. '
  'KYC must be complete before any payout is processed.';

COMMENT ON TABLE public.reward_payouts IS
  'P2 Rewards monetary: append-only payout ledger. Aggregator cron processes '
  'pending rows on the first of each month. Withheld rows are anti-fraud-flagged.';
