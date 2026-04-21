-- M3: blast_radius_cache MV refresh enforcement
-- Without this cron, the cache silently goes stale and downstream agentic
-- recommendations work off old graph state. Refreshes are CONCURRENT (the
-- existing idx_blast_radius_pair unique index makes this possible) so reads
-- never block. An advisory lock prevents two cron workers running the refresh
-- simultaneously (which would error or duplicate work).

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION refresh_blast_radius_cache_safe()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  got_lock boolean;
BEGIN
  -- Try lock; if another refresh is in flight just skip silently.
  got_lock := pg_try_advisory_lock(hashtext('refresh_blast_radius_cache')::bigint);
  IF NOT got_lock THEN
    RAISE NOTICE 'blast_radius_cache refresh already in progress, skipping';
    RETURN;
  END IF;

  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY blast_radius_cache;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('refresh_blast_radius_cache')::bigint);
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('refresh_blast_radius_cache')::bigint);
END;
$$;

COMMENT ON FUNCTION refresh_blast_radius_cache_safe() IS
  'V5.3 §2.3.3: Refresh blast_radius_cache CONCURRENTLY guarded by pg_advisory_lock. Idempotent.';

-- Schedule every 15 min. cron.schedule is idempotent on the same job name.
SELECT cron.schedule(
  'refresh_blast_radius_cache',
  '*/15 * * * *',
  $$ SELECT refresh_blast_radius_cache_safe(); $$
);

-- ---------------------------------------------------------------------------
-- Per-project graph_edges pruning replaces the previous hardcoded 180-day
-- horizon. Each project's `graph_edge_retention_days` setting drives its own
-- pruning cadence. Default falls back to 180 days for projects with no row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prune_graph_edges_per_project()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  rec record;
  total_deleted integer := 0;
  deleted integer;
BEGIN
  FOR rec IN
    SELECT p.id AS project_id, COALESCE(ps.graph_edge_retention_days, 180) AS retention_days
    FROM projects p
    LEFT JOIN project_settings ps ON ps.project_id = p.id
  LOOP
    DELETE FROM graph_edges
    WHERE project_id = rec.project_id
      AND created_at < (now() - make_interval(days => rec.retention_days));
    GET DIAGNOSTICS deleted = ROW_COUNT;
    total_deleted := total_deleted + COALESCE(deleted, 0);
  END LOOP;

  RETURN total_deleted;
END;
$$;

COMMENT ON FUNCTION prune_graph_edges_per_project() IS
  'V5.3 §2.3.3: Per-project pruning of graph_edges based on project_settings.graph_edge_retention_days.';

-- Daily prune at 03:17 UTC (off-peak, offset to avoid colliding with judge-batch).
SELECT cron.schedule(
  'prune_graph_edges_per_project',
  '17 3 * * *',
  $$ SELECT prune_graph_edges_per_project(); $$
);
