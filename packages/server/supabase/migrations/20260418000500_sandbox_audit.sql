-- Migration: 20260418000500_sandbox_audit
-- Purpose:   Persist managed-sandbox runs and per-event audit logs (V5.3 §2.10, M6).
--            One fix_attempt may create N sandbox runs (e.g., setup + verify),
--            and each run emits many audit events (exec, file_write, network).

-- =============================================================================
-- 1. project_settings: which sandbox provider this project uses
-- =============================================================================
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS sandbox_provider TEXT
    NOT NULL DEFAULT 'local-noop'
    CHECK (sandbox_provider IN ('local-noop', 'e2b', 'modal', 'cloudflare')),
  ADD COLUMN IF NOT EXISTS sandbox_image TEXT
    NOT NULL DEFAULT 'mushi-fix-base:latest',
  ADD COLUMN IF NOT EXISTS sandbox_extra_allowed_hosts TEXT[]
    NOT NULL DEFAULT ARRAY[]::TEXT[];

-- =============================================================================
-- 2. fix_sandbox_runs: one row per provisioned sandbox VM
-- =============================================================================
CREATE TABLE IF NOT EXISTS fix_sandbox_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fix_attempt_id uuid REFERENCES fix_attempts(id) ON DELETE CASCADE,
  report_id uuid REFERENCES reports(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('local-noop', 'e2b', 'modal', 'cloudflare')),
  provider_sandbox_id TEXT,
  image TEXT NOT NULL,
  cpu_count INT NOT NULL,
  memory_mb INT NOT NULL,
  disk_mb INT NOT NULL,
  timeout_sec INT NOT NULL,
  network_deny_by_default BOOLEAN NOT NULL,
  network_allowed_hosts TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting', 'running', 'completed', 'failed', 'killed', 'timeout')),
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fix_sandbox_runs_project_started
  ON fix_sandbox_runs (project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_fix_sandbox_runs_attempt
  ON fix_sandbox_runs (fix_attempt_id);

ALTER TABLE fix_sandbox_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read own project sandbox runs" ON fix_sandbox_runs
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

-- writes only via service_role (worker)
CREATE POLICY "service role write sandbox runs" ON fix_sandbox_runs
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- =============================================================================
-- 3. fix_sandbox_events: per-event audit log (exec/file/network/destroy)
-- =============================================================================
CREATE TABLE IF NOT EXISTS fix_sandbox_events (
  id BIGSERIAL PRIMARY KEY,
  sandbox_run_id uuid NOT NULL REFERENCES fix_sandbox_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL CHECK (event_type IN
    ('spawn', 'exec', 'network', 'file_read', 'file_write', 'destroy', 'error')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_fix_sandbox_events_run_ts
  ON fix_sandbox_events (sandbox_run_id, ts);
CREATE INDEX IF NOT EXISTS idx_fix_sandbox_events_project_type
  ON fix_sandbox_events (project_id, event_type, ts DESC);
-- partial index for fast incident triage on policy violations
CREATE INDEX IF NOT EXISTS idx_fix_sandbox_events_errors
  ON fix_sandbox_events (project_id, ts DESC)
  WHERE event_type = 'error';

ALTER TABLE fix_sandbox_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read own project sandbox events" ON fix_sandbox_events
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "service role write sandbox events" ON fix_sandbox_events
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- =============================================================================
-- 4. Retention: events are noisy. Keep 30 days unless user overrides.
-- =============================================================================
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS sandbox_event_retention_days INT
    NOT NULL DEFAULT 30
    CHECK (sandbox_event_retention_days BETWEEN 7 AND 365);

-- Joins projects -> project_settings on the FK (project_settings.project_id),
-- not project_settings.id (which is the table's own auto PK and would never
-- match fix_sandbox_events.project_id). Defaults to 30-day retention for
-- projects with no settings row. Mirrors prune_graph_edges_per_project in
-- 20260418000200_blast_radius_mv_refresh.sql.
CREATE OR REPLACE FUNCTION prune_sandbox_events_per_project() RETURNS INTEGER AS $$
DECLARE
  total_pruned INTEGER := 0;
  rec RECORD;
  pruned INTEGER;
BEGIN
  FOR rec IN
    SELECT p.id AS project_id,
           COALESCE(ps.sandbox_event_retention_days, 30) AS retention_days
    FROM projects p
    LEFT JOIN project_settings ps ON ps.project_id = p.id
  LOOP
    DELETE FROM fix_sandbox_events
     WHERE project_id = rec.project_id
       AND ts < now() - make_interval(days => rec.retention_days);
    GET DIAGNOSTICS pruned = ROW_COUNT;
    total_pruned := total_pruned + pruned;
  END LOOP;
  RETURN total_pruned;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION prune_sandbox_events_per_project() FROM PUBLIC;

-- pg_cron may not be installed in dev/self-hosted environments. Guard the
-- whole block so the migration is a no-op when the extension is absent.
-- PERFORM does not accept a WHERE clause, so the optional unschedule is
-- wrapped in its own IF EXISTS check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune_sandbox_events_per_project') THEN
      PERFORM cron.unschedule('prune_sandbox_events_per_project');
    END IF;
    PERFORM cron.schedule(
      'prune_sandbox_events_per_project',
      '23 4 * * *',
      $cron$ SELECT prune_sandbox_events_per_project(); $cron$
    );
  END IF;
END $$;
