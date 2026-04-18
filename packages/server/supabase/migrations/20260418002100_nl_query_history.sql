-- Migration: 20260418002100_nl_query_history
-- Purpose:   Persist every natural-language query (success or failure) so
--            the Query page can show a real history sidebar instead of
--            React-state-only rerun list.

CREATE TABLE IF NOT EXISTS nl_query_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prompt       text NOT NULL,
  sql          text,
  summary      text,
  explanation  text,
  row_count    int  NOT NULL DEFAULT 0,
  error        text,
  latency_ms   int,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nl_query_history_user
  ON nl_query_history (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nl_query_history_project
  ON nl_query_history (project_id, created_at DESC);

ALTER TABLE nl_query_history ENABLE ROW LEVEL SECURITY;

-- Owners read their project's history; service_role bypasses RLS for the
-- API server, which is the only writer.
DROP POLICY IF EXISTS nl_query_history_owner_read ON nl_query_history;
CREATE POLICY nl_query_history_owner_read
  ON nl_query_history
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR project_id IN (
      SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())
    )
  );

COMMENT ON TABLE nl_query_history IS
  'Phase 2.3 of admin-console-tab-overhaul: persistent NL query history with rerun + audit.';
