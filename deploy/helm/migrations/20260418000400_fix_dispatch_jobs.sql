-- M5: Admin-triggered fix dispatch queue
-- The Edge Function cannot itself host @mushi-mushi/agents (Node-only with
-- GitHub SDK + sandboxes). Pattern: admin POSTs to a thin enqueue endpoint
-- which writes a row to fix_dispatch_jobs; the agents worker process polls
-- this table and runs FixOrchestrator.run.

CREATE TABLE IF NOT EXISTS fix_dispatch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  fix_attempt_id uuid REFERENCES fix_attempts(id) ON DELETE SET NULL,
  pr_url TEXT,
  error TEXT,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fix_dispatch_status
  ON fix_dispatch_jobs (status, created_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_fix_dispatch_project
  ON fix_dispatch_jobs (project_id, created_at DESC);

ALTER TABLE fix_dispatch_jobs ENABLE ROW LEVEL SECURITY;

-- Project members can see dispatch jobs for their projects.
CREATE POLICY fix_dispatch_select_member ON fix_dispatch_jobs
  FOR SELECT USING (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

-- Project members can request a dispatch (write-only, status forced to queued).
CREATE POLICY fix_dispatch_insert_member ON fix_dispatch_jobs
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

COMMENT ON TABLE fix_dispatch_jobs IS
  'V5.3 §2.10: Admin-triggered fix dispatch queue. Agents worker polls and runs FixOrchestrator.';
