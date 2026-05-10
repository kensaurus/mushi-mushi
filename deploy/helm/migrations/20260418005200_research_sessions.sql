-- Migration: 20260418005200_research_sessions
-- Purpose:   Persist manual web-research the admin runs against Firecrawl
--            during triage, so snippets can be revisited and attached to
--            specific reports as evidence.
--
-- TWO TABLES:
--   * research_sessions   — one row per query the admin issues.
--   * research_snippets   — one row per result returned, optionally linked
--                            to a report via attached_to_report_id.

CREATE TABLE IF NOT EXISTS research_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query       TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'search' CHECK (mode IN ('search','scrape')),
  domains     TEXT[] NOT NULL DEFAULT '{}'::text[],
  result_count INT NOT NULL DEFAULT 0,
  cached      BOOLEAN NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_sessions_project_created
  ON research_sessions (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_snippets (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               uuid NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
  project_id               uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url                      TEXT NOT NULL,
  title                    TEXT,
  snippet                  TEXT,
  markdown                 TEXT,
  attached_to_report_id    uuid REFERENCES reports(id) ON DELETE SET NULL,
  attached_at              TIMESTAMPTZ,
  attached_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_snippets_session
  ON research_snippets (session_id);

CREATE INDEX IF NOT EXISTS idx_research_snippets_project_attached
  ON research_snippets (project_id, attached_to_report_id)
  WHERE attached_to_report_id IS NOT NULL;

ALTER TABLE research_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_snippets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read research sessions"
  ON research_sessions
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "service role write research sessions"
  ON research_sessions
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

CREATE POLICY "members read research snippets"
  ON research_snippets
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "service role write research snippets"
  ON research_snippets
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');
