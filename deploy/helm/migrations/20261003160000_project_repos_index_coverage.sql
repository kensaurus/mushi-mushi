-- ============================================================================
-- 20261003160000_project_repos_index_coverage
--
-- ADDITIVE: apply BEFORE deploying the webhooks-github-indexer and api
-- functions. Both select and write these columns; until this runs the
-- sweep's bookkeeping update fails and the stats route reads them as NULL.
--
-- Gap #16a/#16b (codebase index coverage):
--
--   A capped sweep (at most N files per run, by plan) used to set
--   last_indexed_at like a full one, so a half-indexed monorepo read as
--   fresh and was not swept again for 24 hours. From now on:
--
--   last_indexed_at        (unchanged column) only set when the sweep
--                          covered every eligible file.
--   index_swept_at         every successful sweep, complete or not. Drives
--                          staleness and "last swept" in the console.
--   index_files_indexed    distinct eligible files in the index after the
--                          sweep (files, not chunks).
--   index_files_eligible   indexable files in the repo tree at that sweep.
--   index_file_cap         the plan's coverage ceiling used by that sweep.
--   index_tree_truncated   GitHub truncated the tree listing, so
--                          index_files_eligible is a lower bound.
--   index_coverage_state   complete | filling | capped | stalled
--                            filling: later sweeps will add files (picked
--                                     up every hour until it is not);
--                            capped:  the plan ceiling (or a truncated
--                                     tree) stops it short of the repo;
--                            stalled: short of the repo, but the last
--                                     sweep added no file (fetches or
--                                     embeddings keep failing). Swept on
--                                     the normal staleness cadence, with
--                                     the reason in last_index_error.
--   Pushes (App or PAT webhook) also update index_files_* and the state,
--   but not index_swept_at, so the daily sweep still reconciles.
--
-- No CHECK constraint on index_coverage_state on purpose: the writer is the
-- indexer alone, and a constraint mismatch would fail the bookkeeping update
-- silently behind a 200 (see the fail-open notes in 20261002140100).
-- project_repos already has RLS enabled; no policy change.
-- ============================================================================

ALTER TABLE public.project_repos
  ADD COLUMN IF NOT EXISTS index_swept_at timestamptz,
  ADD COLUMN IF NOT EXISTS index_files_indexed integer,
  ADD COLUMN IF NOT EXISTS index_files_eligible integer,
  ADD COLUMN IF NOT EXISTS index_file_cap integer,
  ADD COLUMN IF NOT EXISTS index_tree_truncated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS index_coverage_state text;

COMMENT ON COLUMN public.project_repos.last_indexed_at IS
  'Last sweep that covered every eligible file. A partial sweep sets index_swept_at only.';
COMMENT ON COLUMN public.project_repos.index_swept_at IS
  'Last successful sweep, complete or partial.';
COMMENT ON COLUMN public.project_repos.index_files_indexed IS
  'Distinct eligible files in the index after the last sweep (files, not chunks).';
COMMENT ON COLUMN public.project_repos.index_files_eligible IS
  'Indexable files in the repo tree at the last sweep (a lower bound when index_tree_truncated).';
COMMENT ON COLUMN public.project_repos.index_file_cap IS
  'Plan coverage ceiling (files) the last sweep used.';
COMMENT ON COLUMN public.project_repos.index_tree_truncated IS
  'GitHub truncated the tree listing at the last sweep.';
COMMENT ON COLUMN public.project_repos.index_coverage_state IS
  'complete | filling (later sweeps add files) | capped (plan ceiling or truncated tree) | stalled (last sweep added no file; see last_index_error). NULL until the first sweep after 20261003160000.';

-- Existing partial rows: their last_indexed_at was set by a capped sweep.
-- Copy it into index_swept_at so staleness keeps working; the next sweep
-- records real coverage (rows with NULL index_coverage_state are swept as
-- stale-or-unknown, oldest attempt first).
UPDATE public.project_repos
   SET index_swept_at = last_indexed_at
 WHERE index_swept_at IS NULL
   AND last_indexed_at IS NOT NULL;
