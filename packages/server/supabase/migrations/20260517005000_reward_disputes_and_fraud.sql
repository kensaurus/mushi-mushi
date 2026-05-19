-- Migration: reward_disputes_and_fraud
-- PURPOSE: P3 rewards — dispute resolution flow, per-org monthly payout cap,
--   and anomaly detection cron that flags users with suspicious point velocity.

-- ── reward_disputes ───────────────────────────────────────────────────
-- Tracks disputed rewards; admin can resolve with approve/deny.
CREATE TABLE IF NOT EXISTS public.reward_disputes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  end_user_id     uuid        NOT NULL REFERENCES public.end_users(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payout_id       uuid        REFERENCES public.reward_payouts(id) ON DELETE SET NULL,
  activity_id     uuid        REFERENCES public.end_user_activity(id) ON DELETE SET NULL,
  reason          text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  status          text        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'under_review', 'approved', 'denied', 'withdrawn')),
  resolution_notes text,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER reward_disputes_updated_at
  BEFORE UPDATE ON public.reward_disputes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_reward_disputes_org
  ON public.reward_disputes (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_reward_disputes_end_user
  ON public.reward_disputes (end_user_id);

ALTER TABLE public.reward_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY reward_disputes_org_admin ON public.reward_disputes
  FOR ALL TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['admin']));

COMMENT ON TABLE public.reward_disputes IS
  'P3 Rewards: dispute resolution log. Admins review and approve/deny disputed rewards. Denied disputes prevent payouts from processing.';

-- ── Anomaly detection: daily cron that flags suspicious users ─────────
-- Flags end_users whose points_30d is > 5× the org median.
-- Flagged users can still earn but cannot withdraw monetary rewards.
CREATE OR REPLACE FUNCTION private.detect_reward_anomalies()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  org_row RECORD;
  org_median numeric;
  flagged_count int;
BEGIN
  FOR org_row IN
    SELECT DISTINCT organization_id FROM public.end_user_points
    WHERE points_30d > 0
  LOOP
    -- Compute median points_30d for this org
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY points_30d)
    INTO org_median
    FROM public.end_user_points
    WHERE organization_id = org_row.organization_id
      AND points_30d > 0;

    CONTINUE WHEN org_median IS NULL OR org_median < 10;

    -- Flag users with points_30d > 5× median
    UPDATE public.end_users eu
    SET
      anti_fraud_flags = array_append(
        array_remove(eu.anti_fraud_flags, 'velocity_anomaly'),
        'velocity_anomaly'
      ),
      updated_at = now()
    WHERE eu.organization_id = org_row.organization_id
      AND eu.id IN (
        SELECT end_user_id
        FROM public.end_user_points
        WHERE organization_id = org_row.organization_id
          AND points_30d > 5 * org_median
      )
      AND NOT ('velocity_anomaly' = ANY(eu.anti_fraud_flags));

    GET DIAGNOSTICS flagged_count = ROW_COUNT;

    -- Unflag users that fell back below the threshold
    UPDATE public.end_users eu
    SET
      anti_fraud_flags = array_remove(eu.anti_fraud_flags, 'velocity_anomaly'),
      updated_at = now()
    WHERE eu.organization_id = org_row.organization_id
      AND 'velocity_anomaly' = ANY(eu.anti_fraud_flags)
      AND eu.id IN (
        SELECT end_user_id
        FROM public.end_user_points
        WHERE organization_id = org_row.organization_id
          AND points_30d <= 5 * org_median
      );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION private.detect_reward_anomalies() FROM public;
GRANT EXECUTE ON FUNCTION private.detect_reward_anomalies() TO service_role;

COMMENT ON FUNCTION private.detect_reward_anomalies() IS
  'P3 Rewards: daily anomaly detection. Flags end_users with points_30d > 5× org median with velocity_anomaly anti-fraud flag. Flagged users cannot redeem monetary rewards.';

-- ── Schedule anomaly detection cron ──────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'detect-reward-anomalies',
      '0 4 * * *',  -- daily at 04:00 UTC (after the activity-prune cron at 03:00)
      $sql$
        SELECT private.detect_reward_anomalies();
      $sql$
    );
  END IF;
END;
$$;

-- ── Monthly payout budget cap check function ─────────────────────────
-- Called by the payout aggregator before processing. Returns true if
-- processing this payout would exceed the org's monthly budget cap.
CREATE OR REPLACE FUNCTION public.check_payout_budget(
  p_organization_id uuid,
  p_amount_usd      numeric
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH monthly_total AS (
    SELECT COALESCE(SUM(amount_usd), 0) AS paid_this_month
    FROM public.reward_payouts
    WHERE organization_id = p_organization_id
      AND status IN ('paid', 'processing')
      AND requested_at >= date_trunc('month', now())
  ),
  budget AS (
    SELECT rewards_monthly_payout_budget_usd AS cap
    FROM public.project_settings ps
    JOIN public.projects p ON p.id = ps.project_id
    WHERE p.organization_id = p_organization_id
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'cap', b.cap,
    'paid_this_month', m.paid_this_month,
    'headroom', CASE WHEN b.cap IS NULL THEN NULL ELSE b.cap - m.paid_this_month END,
    'would_exceed', CASE
      WHEN b.cap IS NULL THEN false
      ELSE (m.paid_this_month + p_amount_usd) > b.cap
    END,
    'pct_used', CASE
      WHEN b.cap IS NULL OR b.cap = 0 THEN null
      ELSE round(m.paid_this_month * 100.0 / b.cap, 1)
    END
  )
  FROM monthly_total m, budget b;
$$;

REVOKE ALL ON FUNCTION public.check_payout_budget(uuid, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.check_payout_budget(uuid, numeric) TO service_role;

COMMENT ON FUNCTION public.check_payout_budget(uuid, numeric) IS
  'P3 Rewards: returns budget headroom and whether adding p_amount_usd would exceed the org''s monthly payout cap. Returns {cap, paid_this_month, headroom, would_exceed, pct_used}.';
