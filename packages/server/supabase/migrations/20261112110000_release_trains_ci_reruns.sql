-- ============================================================================
-- A release train re-runs its failed checks once before it blames a fix
-- (2026-11-12).
--
-- SBC train #1299 failed because the CI runner could not install Playwright's
-- browsers (apt exit 100); glot.it's legibility gate failed twice on a page
-- that had not hydrated yet. Both times the merge queue treated the red check
-- as the members' code: the train was closed and its only member blocked
-- ("a CI-repair agent may fix it"). Now the first red result re-runs the
-- failed workflow runs; only a second red bisects or blocks. The counter
-- lives here because the train's `detail` text is rewritten on every tick.
-- ============================================================================

ALTER TABLE public.release_trains
  ADD COLUMN IF NOT EXISTS ci_reruns smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.release_trains.ci_reruns IS
  'How many times the merge queue re-ran this train''s failed checks before judging it red (at most TRAIN_CI_RERUNS).';
