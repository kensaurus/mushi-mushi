-- =============================================================================
-- Migration: wallet_debit_dead_letters
-- =============================================================================
-- 2026-08-16 resilience audit C3: a wallet debit that failed after a
-- successful paid provider call was retried once and then console.error'd —
-- silent revenue loss with no replay path. This table receives those lost
-- debits via the sink registered in _shared/hosted-llm-billing.ts.
--
-- request_id is UNIQUE: the debit RPC dedupes on requestId, so an operator
-- (or a future cron) can replay rows safely and mark replayed_at.
-- Service-role only: RLS enabled with no policies.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wallet_debit_dead_letters (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          text        NOT NULL,
  app                 text        NOT NULL,
  feature             text        NOT NULL,
  model               text,
  provider_cost_micro bigint      NOT NULL DEFAULT 0,
  error               text,
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  replayed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_debit_dead_letters_request
  ON public.wallet_debit_dead_letters (request_id);

CREATE INDEX IF NOT EXISTS idx_wallet_debit_dead_letters_unreplayed
  ON public.wallet_debit_dead_letters (created_at)
  WHERE replayed_at IS NULL;

ALTER TABLE public.wallet_debit_dead_letters ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.wallet_debit_dead_letters IS
  'Lost wallet debits (provider call succeeded, debit failed twice). '
  'Replay-safe via the debit RPC requestId dedupe; stamp replayed_at after replay.';
