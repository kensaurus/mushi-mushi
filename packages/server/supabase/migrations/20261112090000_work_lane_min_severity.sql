-- ============================================================================
-- Drain floor per local lane (2026-11-12).
--
-- An owner with ~1,000 open reports wants the local workers to fix the worst
-- ones first and leave the rest: "fix only high and critical". A lane already
-- claims worst first, but with no floor it keeps going into medium and low
-- once the top is empty, on the owner's agent plan.
--
-- min_severity is server-only, like review_model: the claim route applies it,
-- the heartbeat never sends it, so a daemon that predates it never sees an
-- unknown setting. NULL = every severity (the old behaviour). A report a person
-- queued in the lane is claimed whatever its severity: they chose it.
-- ============================================================================

ALTER TABLE public.work_lanes
  ADD COLUMN IF NOT EXISTS min_severity text
    CHECK (min_severity IS NULL OR min_severity IN ('critical', 'high', 'medium'));

COMMENT ON COLUMN public.work_lanes.min_severity IS
  'Lowest severity the lane claims from the ranked list (critical, high, medium); NULL = all. Queued reports ignore it.';
