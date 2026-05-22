-- Migration: tester_credit_ledger
-- PURPOSE: Wave 1 — the mushi-points ledger for testers.
--   Separate from end_user_points (which is per-org / per-host-app and
--   never portable). Testers earn one cross-app mushi-points balance keyed
--   to their mushi_testers.id.
--
-- Points are always awarded server-side (never client-side) and append to
-- this append-only ledger. A trigger keeps tester_balances in sync.

-- ── tester_credit_ledger ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tester_credit_ledger (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tester_id           uuid        NOT NULL REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  delta_points        int         NOT NULL, -- positive = earn, negative = spend
  balance_after_points int        NOT NULL CHECK (balance_after_points >= 0),
  reason              text        NOT NULL
                        CHECK (reason IN (
                          'submission_accepted',
                          'quest_completed',
                          'reputation_bonus',
                          'admin_grant',
                          'redemption',
                          'reversal'
                        )),
  submission_id       uuid        REFERENCES public.tester_submissions(id) ON DELETE SET NULL,
  redemption_id       uuid, -- FK to tester_redemptions added in migration 20260523004000
  app_id              uuid        REFERENCES public.published_apps(id) ON DELETE SET NULL,
  -- idempotency_key prevents double-credit on retry. Set by the API route.
  idempotency_key     text        UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tester_ledger_tester
  ON public.tester_credit_ledger (tester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tester_ledger_app
  ON public.tester_credit_ledger (app_id, created_at DESC)
  WHERE app_id IS NOT NULL;

-- Append-only: no UPDATE or DELETE (use 'reversal' entries to correct).
ALTER TABLE public.tester_credit_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY tester_ledger_self_read ON public.tester_credit_ledger
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

-- Publish to realtime so the wallet page updates live.
ALTER PUBLICATION supabase_realtime ADD TABLE public.tester_credit_ledger;

COMMENT ON TABLE public.tester_credit_ledger IS
  'Append-only mushi-points ledger for testers. balance_after_points is '
  'denormalized for fast balance reads without a SUM scan. '
  'Never insert directly — use the award_tester_points() RPC.';

-- ── tester_balances ────────────────────────────────────────────────────────
-- Denormalized balance summary kept in sync by trigger.
-- Avoids SUM scans on the ledger for every wallet page load.
CREATE TABLE IF NOT EXISTS public.tester_balances (
  tester_id               uuid    PRIMARY KEY REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  total_points_lifetime   int     NOT NULL DEFAULT 0 CHECK (total_points_lifetime >= 0),
  total_points_30d        int     NOT NULL DEFAULT 0 CHECK (total_points_30d >= 0),
  current_points          int     NOT NULL DEFAULT 0 CHECK (current_points >= 0),
  last_evaluated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tester_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY tester_balances_self_read ON public.tester_balances
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

-- Publish to realtime so the wallet page updates live.
ALTER PUBLICATION supabase_realtime ADD TABLE public.tester_balances;

-- ── tester_reputation ─────────────────────────────────────────────────────
-- HackerOne-style reputation summary. Recomputed daily by the
-- recompute-tester-reputation cron edge function.
CREATE TABLE IF NOT EXISTS public.tester_reputation (
  tester_id           uuid    PRIMARY KEY REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  score               int     NOT NULL DEFAULT 0,
  signal_pct          numeric NOT NULL DEFAULT 0 CHECK (signal_pct BETWEEN 0 AND 100),
  impact_pct          numeric NOT NULL DEFAULT 0 CHECK (impact_pct BETWEEN 0 AND 100),
  leaderboard_rank_30d int,
  recomputed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tester_rep_score
  ON public.tester_reputation (score DESC);

ALTER TABLE public.tester_reputation ENABLE ROW LEVEL SECURITY;

-- Testers can read their own reputation.
CREATE POLICY tester_rep_self_read ON public.tester_reputation
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

-- Org admins can read reputation for tester-review decisions.
CREATE POLICY tester_rep_org_admin_read ON public.tester_reputation
  FOR SELECT TO authenticated
  USING (true); -- reputation scores are non-PII; any authenticated user may read

COMMENT ON TABLE public.tester_reputation IS
  'Denormalized reputation summary per tester. Score follows the HackerOne '
  'formula: +7 accepted, +2 dup-of-resolved, 0 informative, -5 not-applicable, '
  '-10 spam, sigma-bonus for large bounties. Recomputed daily.';

-- ── trigger: keep tester_balances in sync ─────────────────────────────────
-- Fires AFTER INSERT on tester_credit_ledger to upsert the balances row.
-- 30d points uses a 720h window (approx 30 days).
CREATE OR REPLACE FUNCTION private.sync_tester_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_tester_id uuid := NEW.tester_id;
  v_current   int;
  v_lifetime  int;
  v_30d       int;
BEGIN
  -- Current balance from the ledger's own denormalized column.
  v_current  := NEW.balance_after_points;

  -- Lifetime = sum of positive deltas.
  SELECT COALESCE(SUM(delta_points) FILTER (WHERE delta_points > 0), 0)
    INTO v_lifetime
    FROM public.tester_credit_ledger
   WHERE tester_id = v_tester_id;

  -- 30-day rolling.
  SELECT COALESCE(SUM(delta_points) FILTER (WHERE delta_points > 0), 0)
    INTO v_30d
    FROM public.tester_credit_ledger
   WHERE tester_id = v_tester_id
     AND created_at >= (now() - interval '30 days');

  INSERT INTO public.tester_balances (
    tester_id, current_points, total_points_lifetime, total_points_30d, last_evaluated_at
  ) VALUES (
    v_tester_id, v_current, v_lifetime, v_30d, now()
  )
  ON CONFLICT (tester_id) DO UPDATE SET
    current_points        = EXCLUDED.current_points,
    total_points_lifetime = EXCLUDED.total_points_lifetime,
    total_points_30d      = EXCLUDED.total_points_30d,
    last_evaluated_at     = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER tester_ledger_sync_balance
  AFTER INSERT ON public.tester_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION private.sync_tester_balance();
