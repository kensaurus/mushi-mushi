-- ============================================================
-- Mushi Mushi v2 — Bidirectional Knowledge Graph (Phase 1)
--
-- WHITEPAPER REFERENCE:
--   §3 The Bug Knowledge Graph — Data Model
--   §4 Architecture & Core Modules
--   §5 The Five Pre-Release Gates
--   Appendix A inventory.yaml schema
--   Appendix C Cypher graph schema
--
-- WHY IT EXISTS:
--   v1 only modelled the negative side of the graph (Reports, Errors,
--   regression edges). To catch the dominant 2026 failure mode —
--   "code that ships claiming to work but isn't wired" — we also need
--   the positive side: Apps, Pages, Elements, Actions, ApiDeps, DbDeps,
--   Tests, UserStories. This migration adds the storage for both halves
--   without touching v1 data.
--
-- DESIGN CHOICES:
--   - graph_nodes.node_type / graph_edges.edge_type stay TEXT (no CHECK
--     constraint). v1 already mixes shapes via metadata jsonb, so adding
--     an enum here would break extensibility for customer-private types
--     (whitepaper §4.1 extensions block).
--   - Status lives in metadata->>'status' on Action / Element nodes.
--     Status is NEVER written by hand; the Status Reconciler derives it
--     from observable signals (§3.3). The status_history table records
--     every transition for the "claim vs reality" disagreement log.
--   - Inventory snapshots are stored per commit in `inventories` so
--     time-travel diffs (§4.1, §6.8 inventory.diff MCP tool) just work.
--   - gate_runs / gate_findings power the CI Gate Service (§4.3, §5).
--   - synthetic_runs powers the Synthetic Monitor (§4.4) — per-Action
--     latency time-series the admin Synthetic tab consumes.
--   - sentinel_verdicts is the audit log of the Sentinel sub-agent
--     (§4.3 Sentinel) — its APPROVED / REJECTED verdict per test
--     gates the 🟡 → 🟢 status promotion.
--   - All tables are project_id-scoped, RLS-enabled, and follow the
--     same owner-or-org-member policy as v1 (`owner_reads_*` /
--     `service_role_writes_*`).
-- ============================================================

-- ----------------------------------------------------------------
-- Inventory snapshots (whitepaper §4.1)
-- One row per ingestion. The `raw_yaml` lets us re-derive the graph
-- if we ever change the parser; `validation_errors` records what the
-- Zod schema rejected so the UI can surface inline issues without
-- re-running the validator.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha          TEXT,
  schema_version      TEXT NOT NULL DEFAULT '2.0',
  raw_yaml            TEXT NOT NULL,
  parsed              JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors   JSONB NOT NULL DEFAULT '[]'::jsonb,
  source              TEXT NOT NULL DEFAULT 'explicit'
    CHECK (source IN ('explicit', 'crawler', 'hybrid', 'cli')),
  ingested_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current          BOOLEAN NOT NULL DEFAULT true,
  stats               JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_inventories_project ON inventories (project_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventories_commit  ON inventories (project_id, commit_sha);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventories_one_current
  ON inventories (project_id) WHERE is_current = true;

COMMENT ON TABLE inventories IS
  'Per-project inventory.yaml ingestion log. is_current=true marks the snapshot the graph + UI render off. Older rows are kept for time-travel diffs (§4.1).';
COMMENT ON COLUMN inventories.parsed IS
  'Zod-validated tree {app, pages: [{ id, path, elements: [...], ... }], dependencies: { apis: [...], databases: [...] }}.';
COMMENT ON COLUMN inventories.stats IS
  'Aggregate counts written by the ingester: {actions, verified, wired, mocked, stub, regressed, unknown}. Powers the PageHero Decide tile in the admin /inventory page.';

ALTER TABLE inventories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_writes_inventories ON inventories;
CREATE POLICY service_role_writes_inventories
  ON inventories FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS owner_reads_inventories ON inventories;
CREATE POLICY owner_reads_inventories
  ON inventories FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = inventories.project_id AND p.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- Gate runs & findings (whitepaper §4.3, §5)
-- A gate_run is a single (project, commit, gate) execution.
-- A gate_finding is a single rule violation produced by that run.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gate_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha      TEXT,
  pr_number       INTEGER,
  gate            TEXT NOT NULL
    CHECK (gate IN ('dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim')),
  status          TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'pass', 'fail', 'warn', 'skipped', 'error')),
  summary         JSONB NOT NULL DEFAULT '{}'::jsonb,
  findings_count  INTEGER NOT NULL DEFAULT 0,
  triggered_by    TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gate_runs_project_started
  ON gate_runs (project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_runs_project_gate
  ON gate_runs (project_id, gate, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_runs_commit
  ON gate_runs (project_id, commit_sha);

COMMENT ON TABLE gate_runs IS
  'One row per CI Gate Service execution. Composite GitHub status check rolls up the latest five rows (one per gate) for a commit (§5).';

ALTER TABLE gate_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_writes_gate_runs ON gate_runs;
CREATE POLICY service_role_writes_gate_runs
  ON gate_runs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS owner_reads_gate_runs ON gate_runs;
CREATE POLICY owner_reads_gate_runs
  ON gate_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = gate_runs.project_id AND p.owner_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS gate_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_run_id     UUID NOT NULL REFERENCES gate_runs(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  severity        TEXT NOT NULL DEFAULT 'error'
    CHECK (severity IN ('info', 'warn', 'error')),
  rule_id         TEXT,
  message         TEXT NOT NULL,
  file_path       TEXT,
  line            INTEGER,
  col             INTEGER,
  node_id         UUID REFERENCES graph_nodes(id) ON DELETE SET NULL,
  suggested_fix   JSONB,
  allowlisted     BOOLEAN NOT NULL DEFAULT false,
  allowlist_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gate_findings_run
  ON gate_findings (gate_run_id);
CREATE INDEX IF NOT EXISTS idx_gate_findings_project_severity
  ON gate_findings (project_id, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_findings_node
  ON gate_findings (node_id) WHERE node_id IS NOT NULL;

COMMENT ON TABLE gate_findings IS
  'Individual lint/contract/crawl/claim violations. node_id links the finding to the Action it implicates so the admin /inventory page can render findings inline next to their action node.';

ALTER TABLE gate_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_writes_gate_findings ON gate_findings;
CREATE POLICY service_role_writes_gate_findings
  ON gate_findings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS owner_reads_gate_findings ON gate_findings;
CREATE POLICY owner_reads_gate_findings
  ON gate_findings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = gate_findings.project_id AND p.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- Synthetic monitor runs (whitepaper §4.4)
-- One row per Action probe. The DB-side assertion result is folded
-- into `db_assertions` so the UI can show "DB row inserted: yes"
-- next to every successful run.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS synthetic_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_node_id  UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  status          TEXT NOT NULL
    CHECK (status IN ('passed', 'failed', 'error', 'skipped')),
  latency_ms      INTEGER,
  error_message   TEXT,
  db_assertions   JSONB,
  step_results    JSONB,
  trace_url       TEXT,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_synthetic_runs_project_ran
  ON synthetic_runs (project_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_synthetic_runs_action_ran
  ON synthetic_runs (action_node_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_synthetic_runs_failures
  ON synthetic_runs (project_id, ran_at DESC) WHERE status <> 'passed';

COMMENT ON TABLE synthetic_runs IS
  'Per-Action production probes from the Synthetic Monitor. Sparkline + p50/p95/p99 in the admin /inventory Synthetic tab read from this.';

ALTER TABLE synthetic_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_writes_synthetic_runs ON synthetic_runs;
CREATE POLICY service_role_writes_synthetic_runs
  ON synthetic_runs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS owner_reads_synthetic_runs ON synthetic_runs;
CREATE POLICY owner_reads_synthetic_runs
  ON synthetic_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = synthetic_runs.project_id AND p.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- Status history (whitepaper §3.3, §4.6)
-- Append-only log of every status transition the Reconciler emits.
-- This is the data source for the "claim vs reality" disagreement
-- panel and the operator's audit trail when a Pro+ status flip is
-- challenged ("we said it was green; here's the chain of evidence").
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id         UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL
    CHECK (to_status IN ('stub', 'mocked', 'wired', 'verified', 'regressed', 'unknown')),
  trigger         TEXT NOT NULL,
  evidence        JSONB,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_node
  ON status_history (node_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_history_project_changed
  ON status_history (project_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_history_regressions
  ON status_history (project_id, changed_at DESC)
  WHERE to_status = 'regressed';

COMMENT ON TABLE status_history IS
  'Append-only status transition log written by the Status Reconciler. Powers the ActionDetailDrawer "last 50 transitions" panel and the regression alert ribbon.';

ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_writes_status_history ON status_history;
CREATE POLICY service_role_writes_status_history
  ON status_history FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS owner_reads_status_history ON status_history;
CREATE POLICY owner_reads_status_history
  ON status_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = status_history.project_id AND p.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- Sentinel verdicts (whitepaper §4.3 Sentinel sub-agent)
-- Per-test verdict cache. Populated by the sentinel-audit edge
-- function on every CI run. Tests rejected here keep their action
-- at 🟡 even when CI passes, deterministically blocking the
-- "vacuous test" failure mode.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sentinel_verdicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_file       TEXT NOT NULL,
  test_name       TEXT NOT NULL,
  commit_sha      TEXT,
  verdict         TEXT NOT NULL
    CHECK (verdict IN ('approved', 'rejected', 'unknown')),
  reasoning       TEXT,
  suggested_assertions JSONB,
  evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sentinel_verdicts_unique
  ON sentinel_verdicts (project_id, test_file, test_name, COALESCE(commit_sha, ''));
CREATE INDEX IF NOT EXISTS idx_sentinel_verdicts_project_evaluated
  ON sentinel_verdicts (project_id, evaluated_at DESC);

COMMENT ON TABLE sentinel_verdicts IS
  'Cache of Sentinel sub-agent verdicts on tests. Cached per (project, file, test, commit) so re-running the same CI does not re-spend LLM budget.';

ALTER TABLE sentinel_verdicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_writes_sentinel_verdicts ON sentinel_verdicts;
CREATE POLICY service_role_writes_sentinel_verdicts
  ON sentinel_verdicts FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS owner_reads_sentinel_verdicts ON sentinel_verdicts;
CREATE POLICY owner_reads_sentinel_verdicts
  ON sentinel_verdicts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = sentinel_verdicts.project_id AND p.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- Per-project inventory settings
-- Configures the synthetic monitor cadence and crawler auth strategy
-- per project so we do not need to bake them into the cron job.
-- ----------------------------------------------------------------
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS inventory_v2_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS synthetic_monitor_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS synthetic_monitor_cadence_minutes INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS synthetic_monitor_target_url TEXT,
  ADD COLUMN IF NOT EXISTS crawler_base_url TEXT,
  ADD COLUMN IF NOT EXISTS crawler_auth_config JSONB;

COMMENT ON COLUMN project_settings.inventory_v2_enabled IS
  'Feature flag: when true the admin /inventory page is unlocked and the Reconciler/Synthetic crons probe this project. Defaults to false so v1 customers see no behaviour change.';

-- ----------------------------------------------------------------
-- Helper RPCs
--
-- inventory_status_summary(p_project_id) — aggregate count of action
--   nodes by status. The PageHero on /inventory consumes this in a
--   single round trip.
--
-- inventory_user_story_tree(p_project_id) — denormalised tree
--   `[{user_story, pages: [{ page, elements: [{ element, action, ... }] }] }]`
--   the User-Story Map renders without traversing edges client-side.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory_status_summary(p_project_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'total',     COUNT(*) FILTER (WHERE node_type = 'action'),
    'verified',  COUNT(*) FILTER (WHERE node_type = 'action' AND metadata->>'status' = 'verified'),
    'wired',     COUNT(*) FILTER (WHERE node_type = 'action' AND metadata->>'status' = 'wired'),
    'mocked',    COUNT(*) FILTER (WHERE node_type = 'action' AND metadata->>'status' = 'mocked'),
    'stub',      COUNT(*) FILTER (WHERE node_type = 'action' AND metadata->>'status' = 'stub'),
    'regressed', COUNT(*) FILTER (WHERE node_type = 'action' AND metadata->>'status' = 'regressed'),
    'unknown',   COUNT(*) FILTER (
      WHERE node_type = 'action'
        AND (metadata->>'status' IS NULL OR metadata->>'status' = 'unknown')
    ),
    'pages',         COUNT(*) FILTER (WHERE node_type = 'page_v2'),
    'elements',      COUNT(*) FILTER (WHERE node_type = 'element'),
    'user_stories',  COUNT(*) FILTER (WHERE node_type = 'user_story'),
    'api_deps',      COUNT(*) FILTER (WHERE node_type = 'api_dep'),
    'db_deps',       COUNT(*) FILTER (WHERE node_type = 'db_dep'),
    'tests',         COUNT(*) FILTER (WHERE node_type = 'test')
  )
  FROM graph_nodes
  WHERE project_id = p_project_id
$$;

COMMENT ON FUNCTION inventory_status_summary(uuid) IS
  'Aggregate action-status counts for the /inventory PageHero Decide tile. Returns zeros when no inventory has been ingested.';

CREATE OR REPLACE FUNCTION inventory_user_story_tree(p_project_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- Edge direction: ingest writes `action → implements → user_story`
  -- (i.e. the action *implements* the story). The story is the EDGE
  -- TARGET, the action is the SOURCE. Earlier revisions of this RPC had
  -- it reversed and silently returned zero actions per story — the UI
  -- showed the story headers but every card said "0 actions".
  WITH stories AS (
    SELECT id, label, metadata FROM graph_nodes
     WHERE project_id = p_project_id AND node_type = 'user_story'
  ),
  story_actions AS (
    SELECT
      s.id      AS story_id,
      s.label   AS story_label,
      s.metadata AS story_metadata,
      a.id      AS action_id,
      a.label   AS action_label,
      a.metadata AS action_metadata
    FROM stories s
    LEFT JOIN graph_edges e
      ON e.target_node_id = s.id
     AND e.edge_type = 'implements'
    LEFT JOIN graph_nodes a
      ON a.id = e.source_node_id
     AND a.node_type = 'action'
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',       sa.story_id,
        'label',    sa.story_label,
        'metadata', sa.story_metadata,
        'actions',  COALESCE(
          (SELECT jsonb_agg(
             jsonb_build_object(
               'id', sub.action_id,
               'label', sub.action_label,
               'status', COALESCE(sub.action_metadata->>'status', 'unknown'),
               'metadata', sub.action_metadata
             )
           ) FROM story_actions sub WHERE sub.story_id = sa.story_id AND sub.action_id IS NOT NULL),
          '[]'::jsonb
        )
      )
    ),
    '[]'::jsonb
  )
  FROM (SELECT DISTINCT story_id, story_label, story_metadata FROM story_actions) sa
$$;

COMMENT ON FUNCTION inventory_user_story_tree(uuid) IS
  'Denormalised story → action tree the User-Story Map consumes in a single fetch. Returns [] when no stories have been ingested yet.';

-- ----------------------------------------------------------------
-- Realtime publication for live status updates
-- ----------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE status_history;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE gate_runs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE gate_findings;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE inventories;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ----------------------------------------------------------------
-- pg_cron schedules (whitepaper §4.4, §4.6)
--
-- mushi-status-reconciler-tick : every 5 minutes — derives Action /
--   Element status from observable signals, writes status_history.
-- mushi-synthetic-monitor-tick : every 15 minutes — probes prod for
--   every Action whose project has synthetic_monitor_enabled=true.
-- ----------------------------------------------------------------
DO $$
DECLARE
  has_cron BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') INTO has_cron;
  IF NOT has_cron THEN
    RAISE NOTICE 'pg_cron not installed; skipping inventory_v2 schedule registration';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
    FROM cron.job
   WHERE jobname IN ('mushi-status-reconciler-tick', 'mushi-synthetic-monitor-tick');

  PERFORM cron.schedule(
    'mushi-status-reconciler-tick',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/status-reconciler',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body    := '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );

  PERFORM cron.schedule(
    'mushi-synthetic-monitor-tick',
    '*/15 * * * *',
    $cron$
      SELECT net.http_post(
        url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/synthetic-monitor',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body    := '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );
END $$;
