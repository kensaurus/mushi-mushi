-- =============================================================================
-- V5.3 §2.17 Wave B B6 — Apache AGE parallel-write graph backend (Phase 1).
--
-- Background
--   Phase 2 (`knowledge_graph`) modelled the bug graph as two relational
--   tables (`graph_nodes`, `graph_edges`) with a `WITH RECURSIVE` blast-radius
--   materialised view. That works fine up to ~1M edges per project but
--   recursive CTE traversals get expensive past that point.
--
--   Apache AGE adds Cypher and proper graph storage *inside* Postgres, so we
--   can keep transactional writes in the existing tables while issuing the
--   same writes against AGE in parallel. Once AGE has been observed at zero
--   drift for ≥ 30 days we cut reads over and drop the materialised view.
--
-- Phase 1 (this migration) — *parallel write only*:
--   • Conditional AGE bootstrap (graceful skip on managed Postgres without
--     the extension; this becomes a self-host-only feature for now).
--   • Per-project `graph_backend` setting controlling write fan-out:
--       sql_only         (default — current behaviour)
--       sql_age_parallel (write to BOTH; AGE failures are logged, not fatal)
--       age_only         (Phase 3 — refuses today, reserved for cutover)
--   • Tracking columns + audit table for drift detection.
--   • SECURITY DEFINER helpers that issue Cypher only when AGE is loaded.
-- =============================================================================

-- ─── 1. Bootstrap AGE if the extension is present in this Postgres ────────
DO $$
DECLARE
  has_age BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'age')
    INTO has_age;

  IF has_age THEN
    CREATE EXTENSION IF NOT EXISTS age;
    -- Required so the loaded "ag_catalog" namespace is visible when issuing
    -- Cypher via cypher() in subsequent statements.
    LOAD 'age';
    EXECUTE 'SET search_path = ag_catalog, "$user", public';

    -- Idempotent graph creation. SELECT * FROM ag_graph WHERE name = 'mushi'
    -- before calling create_graph() to avoid the "already exists" error.
    IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'mushi') THEN
      PERFORM ag_catalog.create_graph('mushi');
    END IF;
  END IF;
END$$;

-- ─── 2. Settings: per-project backend selector ────────────────────────────
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS graph_backend TEXT NOT NULL DEFAULT 'sql_only'
    CHECK (graph_backend IN ('sql_only', 'sql_age_parallel', 'age_only'));

COMMENT ON COLUMN project_settings.graph_backend IS
  'V5.3 §2.17 Phase 1 — choose the storage tier for the knowledge graph. Phase 1 supports sql_only (default) and sql_age_parallel (writes to both for drift comparison). age_only is reserved for the Phase 3 cutover.';

-- ─── 3. Tracking columns on the relational graph tables ──────────────────
-- We stamp every row with the moment it was last successfully mirrored into
-- AGE. NULL means "never written to AGE" — drift queries treat these as
-- expected drift on freshly-bootstrapped projects, but unexpected drift on
-- projects already in `sql_age_parallel` mode for > 1 hour.
ALTER TABLE graph_nodes
  ADD COLUMN IF NOT EXISTS age_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS age_sync_error TEXT;

ALTER TABLE graph_edges
  ADD COLUMN IF NOT EXISTS age_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS age_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_graph_nodes_age_unsynced
  ON graph_nodes (project_id) WHERE age_synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_graph_edges_age_unsynced
  ON graph_edges (project_id) WHERE age_synced_at IS NULL;

-- ─── 4. Drift audit table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS age_drift_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sql_node_count BIGINT NOT NULL,
  age_node_count BIGINT NOT NULL,
  sql_edge_count BIGINT NOT NULL,
  age_edge_count BIGINT NOT NULL,
  drift_detected BOOLEAN NOT NULL,
  notes JSONB
);

CREATE INDEX IF NOT EXISTS idx_age_drift_audit_project
  ON age_drift_audit (project_id, ran_at DESC);

ALTER TABLE age_drift_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY age_drift_audit_owner_read
  ON age_drift_audit FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

-- ─── 5. Helper: is AGE actually available in this database? ──────────────
-- We need this both at SQL and Edge-Function level so callers can degrade
-- gracefully when self-hosters opt out of AGE.
CREATE OR REPLACE FUNCTION mushi_age_available()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
  loaded BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'age') INTO loaded;
  RETURN loaded;
END;
$$;

-- ─── 6. Cypher write helpers (no-op when AGE is missing) ──────────────────
-- These are intentionally permissive: they LOG WARNINGS rather than raise so
-- a stray failure on the AGE side never fails the SQL write that the
-- application actually depends on. Drift is caught later by the audit.
CREATE OR REPLACE FUNCTION mushi_age_upsert_node(
  p_node_id UUID,
  p_project_id UUID,
  p_node_type TEXT,
  p_label TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, public AS $$
BEGIN
  IF NOT mushi_age_available() THEN
    RETURN FALSE;
  END IF;

  -- AGE Cypher is invoked through the cypher() function. The trailing AS
  -- column list is mandatory — even when we don't read the result.
  PERFORM * FROM cypher('mushi', $cy$
    MERGE (n:Node { id: $node_id })
      ON CREATE SET
        n.project_id = $project_id,
        n.node_type  = $node_type,
        n.label      = $label,
        n.created_at = timestamp()
      ON MATCH SET
        n.label = $label,
        n.updated_at = timestamp()
    RETURN n
  $cy$, $1) AS (n agtype);
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'AGE node upsert failed for %: %', p_node_id, SQLERRM;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION mushi_age_upsert_edge(
  p_edge_id UUID,
  p_project_id UUID,
  p_source_id UUID,
  p_target_id UUID,
  p_edge_type TEXT,
  p_weight DOUBLE PRECISION
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, public AS $$
BEGIN
  IF NOT mushi_age_available() THEN
    RETURN FALSE;
  END IF;

  -- The MATCH side intentionally requires both endpoints to exist. If a
  -- consumer somehow gets here before the nodes have synced, we let the
  -- exception bubble up to the WARNING below and rely on a later pass to
  -- replay the edge.
  PERFORM * FROM cypher('mushi', $cy$
    MATCH (s:Node { id: $source_id }), (t:Node { id: $target_id })
    MERGE (s)-[r:REL { id: $edge_id }]->(t)
      ON CREATE SET
        r.edge_type  = $edge_type,
        r.weight     = $weight,
        r.created_at = timestamp()
      ON MATCH SET
        r.weight = $weight,
        r.updated_at = timestamp()
    RETURN r
  $cy$, $1) AS (r agtype);
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'AGE edge upsert failed for % (% -> %): %',
    p_edge_id, p_source_id, p_target_id, SQLERRM;
  RETURN FALSE;
END;
$$;

-- ─── 7. Drift snapshot helper ────────────────────────────────────────────
-- Compares row counts between the SQL graph and the AGE graph for a given
-- project and writes one row to age_drift_audit. Read-only; safe to run
-- from cron. Returns the audit row id.
CREATE OR REPLACE FUNCTION mushi_age_snapshot_drift(p_project_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, public AS $$
DECLARE
  sql_nodes BIGINT;
  sql_edges BIGINT;
  age_nodes BIGINT := 0;
  age_edges BIGINT := 0;
  drift BOOLEAN;
  audit_id UUID;
BEGIN
  SELECT COUNT(*) INTO sql_nodes FROM graph_nodes WHERE project_id = p_project_id;
  SELECT COUNT(*) INTO sql_edges FROM graph_edges WHERE project_id = p_project_id;

  IF mushi_age_available() THEN
    -- Counting via Cypher: we filter nodes/edges to the requested project
    -- using the project_id we wrote on the node payload.
    BEGIN
      SELECT COALESCE(SUM(c)::BIGINT, 0) INTO age_nodes
        FROM cypher('mushi', $cy$
          MATCH (n:Node { project_id: $project_id })
          RETURN count(n) AS c
        $cy$, jsonb_build_object('project_id', p_project_id::TEXT))
        AS (c agtype);
    EXCEPTION WHEN OTHERS THEN
      age_nodes := -1;
    END;

    BEGIN
      SELECT COALESCE(SUM(c)::BIGINT, 0) INTO age_edges
        FROM cypher('mushi', $cy$
          MATCH (s:Node { project_id: $project_id })-[r:REL]->(:Node)
          RETURN count(r) AS c
        $cy$, jsonb_build_object('project_id', p_project_id::TEXT))
        AS (c agtype);
    EXCEPTION WHEN OTHERS THEN
      age_edges := -1;
    END;
  END IF;

  drift := (sql_nodes <> age_nodes) OR (sql_edges <> age_edges);

  INSERT INTO age_drift_audit (
    project_id, sql_node_count, age_node_count, sql_edge_count, age_edge_count,
    drift_detected, notes
  ) VALUES (
    p_project_id, sql_nodes, age_nodes, sql_edges, age_edges,
    drift,
    jsonb_build_object('age_available', mushi_age_available())
  ) RETURNING id INTO audit_id;

  RETURN audit_id;
END;
$$;

COMMENT ON FUNCTION mushi_age_snapshot_drift(UUID) IS
  'V5.3 §2.17 Phase 1 — count-based drift snapshot. Cheap; intended to run hourly via pg_cron once a project enables sql_age_parallel. Real per-row diff is reserved for the Phase 2 reconciliation worker.';
