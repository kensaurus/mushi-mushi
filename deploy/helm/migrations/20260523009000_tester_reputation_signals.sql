-- Migration: tester_reputation_signals
-- PURPOSE: Wave 8 — adds the append-only reputation event log and the
--   recompute_tester_reputation() function called by the daily cron edge function.

-- ── tester_reputation_events ──────────────────────────────────────────────
-- Append-only audit log. One row per reputation event.
-- score deltas follow the HackerOne formula:
--   +7  submission_accepted
--   +2  submission_duplicate (of a resolved issue)
--    0  submission_informative
--   -5  submission_not_applicable (mapped to 'submission_spam' with delta -5)
--  -10  submission_spam
--  +50  bounty_above_avg (≥ μ+1σ)
--  +25  bounty_at_avg    (> μ)
--  +15  bounty_below_avg (≥ μ−1σ)
CREATE TABLE IF NOT EXISTS public.tester_reputation_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tester_id       uuid        NOT NULL REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN (
                                'submission_accepted',
                                'submission_duplicate',
                                'submission_informative',
                                'submission_spam',
                                'bounty_severe',
                                'bounty_above_avg',
                                'bounty_below_avg',
                                'quest_completed',
                                'manual_adjust'
                              )),
  delta_score     int         NOT NULL,
  submission_id   uuid        REFERENCES public.tester_submissions(id) ON DELETE SET NULL,
  notes           text        CHECK (length(notes) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rep_events_tester
  ON public.tester_reputation_events (tester_id, created_at DESC);

ALTER TABLE public.tester_reputation_events ENABLE ROW LEVEL SECURITY;

-- Only service role writes. No direct client write.
CREATE POLICY tester_rep_events_self_read ON public.tester_reputation_events
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

COMMENT ON TABLE public.tester_reputation_events IS
  'Append-only reputation event log. Never UPDATE or DELETE rows. '
  'To reverse an event, insert a compensating entry with a negative delta_score '
  'and kind=manual_adjust. The recompute_tester_reputation() function sums '
  'this log daily.';

-- ── recompute_tester_reputation() ─────────────────────────────────────────
-- Called by the recompute-tester-reputation cron edge function daily at 04:30 UTC.
-- Accepts an optional p_tester_id to recompute a single tester (for post-review
-- immediate updates). When NULL, recomputes all active testers.
CREATE OR REPLACE FUNCTION private.recompute_tester_reputation(
  p_tester_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_rec record;
  v_score int;
  v_total int;
  v_accepted int;
  v_spam int;
  v_signal_pct numeric;
  v_impact_pct numeric;
  v_rank int;

  -- Bounty sigma stats for impact_pct calculation.
  v_avg_points numeric;
  v_stddev     numeric;
  v_tester_avg numeric;
BEGIN
  -- Aggregate bounty stats across all accepted submissions (for sigma).
  SELECT AVG(points_awarded), STDDEV(points_awarded)
    INTO v_avg_points, v_stddev
    FROM public.tester_submissions
   WHERE status = 'accepted'
     AND points_awarded > 0;

  v_stddev := COALESCE(v_stddev, 0);

  FOR v_rec IN
    SELECT mt.id
      FROM public.mushi_testers mt
     WHERE (p_tester_id IS NULL OR mt.id = p_tester_id)
  LOOP
    -- Sum of all reputation event deltas.
    SELECT COALESCE(SUM(delta_score), 0) INTO v_score
      FROM public.tester_reputation_events
     WHERE tester_id = v_rec.id;

    -- Signal % = accepted / total (submissions in the last 90d).
    SELECT
      COUNT(*)                               AS total,
      COUNT(*) FILTER (WHERE status = 'accepted') AS accepted,
      COUNT(*) FILTER (WHERE status = 'spam') AS spam
    INTO v_total, v_accepted, v_spam
      FROM public.tester_submissions
     WHERE tester_id = v_rec.id
       AND created_at >= (now() - interval '90 days');

    v_signal_pct := CASE WHEN v_total > 0
                         THEN ROUND((v_accepted::numeric / v_total) * 100, 1)
                         ELSE 0 END;

    -- Impact % = how many of the tester's accepted submissions land above avg bounty.
    SELECT COALESCE(AVG(points_awarded), 0)
      INTO v_tester_avg
      FROM public.tester_submissions
     WHERE tester_id = v_rec.id
       AND status = 'accepted'
       AND points_awarded > 0;

    v_impact_pct := CASE
      WHEN v_avg_points IS NULL THEN 0
      WHEN v_avg_points = 0     THEN 0
      ELSE ROUND(LEAST(100, (v_tester_avg / v_avg_points) * 50), 1)
    END;

    -- Clamp score floor to -100 (don't let a troll sink below recoverable).
    v_score := GREATEST(-100, v_score);

    -- Upsert.
    INSERT INTO public.tester_reputation (
      tester_id, score, signal_pct, impact_pct, recomputed_at
    ) VALUES (
      v_rec.id, v_score, v_signal_pct, v_impact_pct, now()
    )
    ON CONFLICT (tester_id) DO UPDATE SET
      score          = EXCLUDED.score,
      signal_pct     = EXCLUDED.signal_pct,
      impact_pct     = EXCLUDED.impact_pct,
      recomputed_at  = now();
  END LOOP;

  -- Update leaderboard ranks (ordinal within all active testers, last 30d points).
  WITH ranked AS (
    SELECT tester_id,
           ROW_NUMBER() OVER (
             ORDER BY total_points_30d DESC, total_points_lifetime DESC
           ) AS rk
      FROM public.tester_balances
  )
  UPDATE public.tester_reputation tr
     SET leaderboard_rank_30d = r.rk
    FROM ranked r
   WHERE r.tester_id = tr.tester_id
     AND (p_tester_id IS NULL OR tr.tester_id = p_tester_id);
END;
$$;

-- ── pg_cron: daily recompute ───────────────────────────────────────────────
SELECT cron.schedule(
  'recompute-tester-reputation-daily',
  '30 4 * * *',
  $$
    CALL private.recompute_tester_reputation();
  $$
);

-- ── award_tester_points() RPC ─────────────────────────────────────────────
-- Server-authoritative helper used by the submission-review API routes and
-- the auto-award fast path. Never called from client-side code.
-- Appends to tester_credit_ledger and fires the sync_tester_balance trigger.
CREATE OR REPLACE FUNCTION public.award_tester_points(
  p_tester_id       uuid,
  p_delta_points    int,
  p_reason          text,
  p_submission_id   uuid        DEFAULT NULL,
  p_app_id          uuid        DEFAULT NULL,
  p_idempotency_key text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_current_balance int;
  v_new_balance     int;
  v_ledger_id       uuid;
BEGIN
  -- Get current balance (0 if no ledger entry yet).
  SELECT COALESCE(current_points, 0) INTO v_current_balance
    FROM public.tester_balances
   WHERE tester_id = p_tester_id;

  v_current_balance := COALESCE(v_current_balance, 0);
  v_new_balance     := v_current_balance + p_delta_points;

  IF v_new_balance < 0 THEN
    RETURN jsonb_build_object('error', 'insufficient_balance', 'current', v_current_balance);
  END IF;

  INSERT INTO public.tester_credit_ledger (
    tester_id, delta_points, balance_after_points, reason,
    submission_id, app_id, idempotency_key
  ) VALUES (
    p_tester_id, p_delta_points, v_new_balance, p_reason,
    p_submission_id, p_app_id,
    COALESCE(p_idempotency_key, gen_random_uuid()::text)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'ledger_id',         v_ledger_id,
    'delta_points',      p_delta_points,
    'balance_after',     v_new_balance,
    'idempotent_skip',   v_ledger_id IS NULL
  );
END;
$$;

COMMENT ON FUNCTION public.award_tester_points IS
  'Server-authoritative tester points award. Idempotent via idempotency_key. '
  'Never call from client-side code — only from API routes with service-role auth.';
