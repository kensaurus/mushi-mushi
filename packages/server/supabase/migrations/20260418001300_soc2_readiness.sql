-- ============================================================
-- Wave C C6: SOC 2 Type 1 readiness
--
-- Adds:
--   * project_retention_policies — per-project retention windows for the
--     CC6.7 / CC8.1 controls (data lifecycle).
--   * data_subject_requests — GDPR/CCPA-style DSAR audit trail.
--   * soc2_evidence — periodic snapshots of control evidence (auto-generated
--     by the soc2-evidence Edge Function).
--   * Helper retention functions invoked from pg_cron.
-- ============================================================

-- 1. Per-project retention windows ------------------------------------------------
CREATE TABLE IF NOT EXISTS project_retention_policies (
  project_id              UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  reports_retention_days  INT NOT NULL DEFAULT 365  CHECK (reports_retention_days > 0),
  audit_retention_days    INT NOT NULL DEFAULT 730  CHECK (audit_retention_days > 0),
  llm_traces_retention_days INT NOT NULL DEFAULT 90 CHECK (llm_traces_retention_days > 0),
  byok_audit_retention_days INT NOT NULL DEFAULT 365 CHECK (byok_audit_retention_days > 0),
  legal_hold              BOOLEAN NOT NULL DEFAULT FALSE,
  legal_hold_reason       TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_retention_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY retention_policies_owner_read
  ON project_retention_policies FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

CREATE POLICY retention_policies_owner_write
  ON project_retention_policies FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

-- 2. DSAR audit trail -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_subject_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'export', 'deletion', 'rectification')),
  subject_email TEXT NOT NULL,
  subject_id   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
  rejection_reason TEXT,
  fulfilled_at  TIMESTAMPTZ,
  fulfilled_by  UUID,
  evidence_url  TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dsar_project_status_idx
  ON data_subject_requests (project_id, status, created_at DESC);

ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY dsar_owner_read
  ON data_subject_requests FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

CREATE POLICY dsar_owner_write
  ON data_subject_requests FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

-- 3. Periodic evidence snapshots --------------------------------------------------
CREATE TABLE IF NOT EXISTS soc2_evidence (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  control     TEXT NOT NULL,            -- e.g. 'CC6.1', 'CC7.2', 'A1.2'
  control_label TEXT,
  status      TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_url TEXT,
  generated_by TEXT NOT NULL DEFAULT 'soc2-evidence-cron',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, control, generated_at)
);

CREATE INDEX IF NOT EXISTS soc2_evidence_project_control_idx
  ON soc2_evidence (project_id, control, generated_at DESC);

ALTER TABLE soc2_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY soc2_evidence_owner_read
  ON soc2_evidence FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

-- 4. Retention helpers ------------------------------------------------------------
-- Single SECURITY DEFINER function so pg_cron and the Edge Function share a
-- single source of truth for retention sweeps.
CREATE OR REPLACE FUNCTION mushi_apply_retention()
RETURNS TABLE(project_id UUID, table_name TEXT, deleted_rows BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  policy RECORD;
  cutoff TIMESTAMPTZ;
  removed BIGINT;
BEGIN
  FOR policy IN
    SELECT prp.*, p.id AS pid
    FROM project_retention_policies prp
    JOIN projects p ON p.id = prp.project_id
    WHERE prp.legal_hold = FALSE
  LOOP
    -- Reports
    cutoff := now() - make_interval(days => policy.reports_retention_days);
    DELETE FROM reports WHERE project_id = policy.pid AND created_at < cutoff;
    GET DIAGNOSTICS removed = ROW_COUNT;
    project_id := policy.pid; table_name := 'reports'; deleted_rows := removed; RETURN NEXT;

    -- Audit logs
    cutoff := now() - make_interval(days => policy.audit_retention_days);
    DELETE FROM audit_logs WHERE project_id = policy.pid AND created_at < cutoff;
    GET DIAGNOSTICS removed = ROW_COUNT;
    project_id := policy.pid; table_name := 'audit_logs'; deleted_rows := removed; RETURN NEXT;

    -- BYOK audit
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'byok_audit_log') THEN
      cutoff := now() - make_interval(days => policy.byok_audit_retention_days);
      EXECUTE format(
        'DELETE FROM byok_audit_log WHERE project_id = $1 AND created_at < $2'
      ) USING policy.pid, cutoff;
      GET DIAGNOSTICS removed = ROW_COUNT;
      project_id := policy.pid; table_name := 'byok_audit_log'; deleted_rows := removed; RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION mushi_apply_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mushi_apply_retention() TO service_role;

-- Daily retention sweep at 03:30 UTC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'mushi-soc2-retention-sweep',
      '30 3 * * *',
      $cron$ SELECT public.mushi_apply_retention(); $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping pg_cron schedule: %', SQLERRM;
END $$;

-- 5. RLS coverage snapshot (read-only utility for evidence runs) -----------------
-- SECURITY DEFINER so the soc2-evidence function can call it under the
-- service role without granting blanket pg_class access to the anon role.
CREATE OR REPLACE FUNCTION mushi_rls_coverage_snapshot()
RETURNS TABLE(table_name TEXT, rls_enabled BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT c.relname::TEXT, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname = 'public'
    AND c.relname NOT LIKE 'pg_%'
    AND c.relname NOT LIKE '\_%';
$$;

REVOKE ALL ON FUNCTION mushi_rls_coverage_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mushi_rls_coverage_snapshot() TO service_role;

-- Daily evidence collection at 04:30 UTC (after retention sweep).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'mushi-soc2-evidence',
      '30 4 * * *',
      $cron$
        SELECT net.http_post(
          url := current_setting('app.settings.functions_base_url', true) || '/soc2-evidence',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
          ),
          body := jsonb_build_object('trigger', 'cron')
        );
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping pg_cron schedule for soc2-evidence: %', SQLERRM;
END $$;

-- 6. Auto-update timestamp trigger ------------------------------------------------
CREATE OR REPLACE FUNCTION mushi_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS retention_policies_touch_updated_at ON project_retention_policies;
CREATE TRIGGER retention_policies_touch_updated_at
  BEFORE UPDATE ON project_retention_policies
  FOR EACH ROW EXECUTE FUNCTION mushi_touch_updated_at();

DROP TRIGGER IF EXISTS dsar_touch_updated_at ON data_subject_requests;
CREATE TRIGGER dsar_touch_updated_at
  BEFORE UPDATE ON data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION mushi_touch_updated_at();

COMMENT ON TABLE project_retention_policies IS
  'SOC 2 CC6.7 / CC8.1 — per-project retention windows. Edited via the admin Compliance page.';
COMMENT ON TABLE data_subject_requests IS
  'GDPR/CCPA DSAR audit trail. Required as evidence under SOC 2 CC2.3.';
COMMENT ON TABLE soc2_evidence IS
  'Periodic control snapshots produced by the soc2-evidence Edge Function. Each row is a single control observation.';
COMMENT ON FUNCTION mushi_apply_retention() IS
  'Applies project-scoped retention windows. Honors legal_hold = TRUE by skipping deletion.';
