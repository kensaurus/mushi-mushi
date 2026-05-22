-- Migration: tester_leaderboard_mv
-- PURPOSE: Wave 5 — creates the tester_leaderboard_30d materialized view
--   for the public marketplace leaderboard. Refreshed every 15 minutes by
--   pg_cron. Anti-fraud-flagged users are excluded.

-- ── tester_leaderboard_30d materialized view ──────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.tester_leaderboard_30d AS
  SELECT
    mt.id                   AS tester_id,
    mt.public_handle,
    mt.display_name,
    mtp.expertise_tags,
    tr.score                AS reputation_score,
    tr.signal_pct,
    tr.leaderboard_rank_30d AS rank,
    tb.total_points_30d,
    tb.total_points_lifetime,
    COUNT(DISTINCT ts.id)   AS submissions_30d,
    COUNT(DISTINCT ts.id) FILTER (WHERE ts.status = 'accepted') AS accepted_30d,
    COUNT(DISTINCT ts.app_id) AS apps_tested_30d
  FROM public.mushi_testers mt
  JOIN public.tester_reputation tr ON tr.tester_id = mt.id
  JOIN public.tester_balances tb ON tb.tester_id = mt.id
  LEFT JOIN public.mushi_tester_profiles mtp ON mtp.tester_id = mt.id
  LEFT JOIN public.tester_submissions ts
    ON ts.tester_id = mt.id
   AND ts.created_at >= (now() - interval '30 days')
  -- Exclude testers with recent spam flags (reputation < -30).
  WHERE tr.score > -30
    -- Require at least one accepted submission in the last 90 days.
    AND EXISTS (
      SELECT 1 FROM public.tester_submissions ts2
       WHERE ts2.tester_id = mt.id
         AND ts2.status = 'accepted'
         AND ts2.created_at >= (now() - interval '90 days')
    )
    -- Never expose testers who have not set a public_handle.
    AND mt.public_handle IS NOT NULL
  GROUP BY
    mt.id, mt.public_handle, mt.display_name,
    mtp.expertise_tags,
    tr.score, tr.signal_pct, tr.leaderboard_rank_30d,
    tb.total_points_30d, tb.total_points_lifetime
  ORDER BY tb.total_points_30d DESC;

-- Unique index required for CONCURRENTLY refresh.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_tester_id
  ON public.tester_leaderboard_30d (tester_id);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rank
  ON public.tester_leaderboard_30d (rank);

-- RLS: anon can read (public leaderboard on the Next.js SSR app).
-- Note: materialized views don't support RLS directly; we use a view wrapper.
CREATE OR REPLACE VIEW public.tester_leaderboard_30d_public AS
  SELECT
    public_handle,
    display_name,
    expertise_tags,
    reputation_score,
    signal_pct,
    rank,
    total_points_30d,
    total_points_lifetime,
    submissions_30d,
    accepted_30d,
    apps_tested_30d
  FROM public.tester_leaderboard_30d
  ORDER BY rank NULLS LAST, total_points_30d DESC
  LIMIT 100;

-- Grant read on the public view to anon role.
GRANT SELECT ON public.tester_leaderboard_30d_public TO anon;
GRANT SELECT ON public.tester_leaderboard_30d_public TO authenticated;

-- ── pg_cron refresh job ───────────────────────────────────────────────────
-- Refreshes the leaderboard MV every 15 minutes (non-blocking CONCURRENTLY).
SELECT cron.schedule(
  'refresh-tester-leaderboard-30d',
  '*/15 * * * *',
  $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.tester_leaderboard_30d;
  $$
);
