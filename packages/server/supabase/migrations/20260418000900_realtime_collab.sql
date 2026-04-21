-- =============================================================================
-- V5.3 §2.13 B2 — real-time triage collaboration
--
-- Adds two tables:
--   1. report_comments     — threaded comments per report, optionally addressed
--                            to a specific reporter (visible-to-reporter flag).
--   2. report_presence     — short-TTL presence rows so multiple admins can see
--                            who else is currently viewing a report. Cleaned by
--                            a 1-min pg_cron job. Supabase Realtime broadcasts
--                            INSERT/UPDATE/DELETE so the admin UI can render
--                            avatars in real time without polling.
--
-- RLS: members of the project can read; only authenticated members can write
-- their own comment/presence rows. The service role keeps full access.
-- =============================================================================

CREATE TABLE IF NOT EXISTS report_comments (
  id BIGSERIAL PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  visible_to_reporter BOOLEAN NOT NULL DEFAULT FALSE,
  parent_id BIGINT REFERENCES report_comments(id) ON DELETE CASCADE,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_comments_report ON report_comments(report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_comments_project ON report_comments(project_id);

ALTER TABLE report_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_report_comments" ON report_comments;
CREATE POLICY "service_role_all_report_comments"
  ON report_comments FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "members_read_report_comments" ON report_comments;
CREATE POLICY "members_read_report_comments"
  ON report_comments FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "members_insert_report_comments" ON report_comments;
CREATE POLICY "members_insert_report_comments"
  ON report_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    author_user_id = (SELECT auth.uid())
    AND project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authors_update_own_report_comments" ON report_comments;
CREATE POLICY "authors_update_own_report_comments"
  ON report_comments FOR UPDATE
  TO authenticated
  USING (author_user_id = (SELECT auth.uid()))
  WITH CHECK (author_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "authors_delete_own_report_comments" ON report_comments;
CREATE POLICY "authors_delete_own_report_comments"
  ON report_comments FOR DELETE
  TO authenticated
  USING (author_user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- Presence
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS report_presence (
  id BIGSERIAL PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  intent TEXT NOT NULL DEFAULT 'viewing'
    CHECK (intent IN ('viewing', 'editing', 'commenting')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '60 seconds',
  UNIQUE (report_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_report_presence_report ON report_presence(report_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_report_presence_expires ON report_presence(expires_at);

ALTER TABLE report_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_report_presence" ON report_presence;
CREATE POLICY "service_role_all_report_presence"
  ON report_presence FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "members_read_report_presence" ON report_presence;
CREATE POLICY "members_read_report_presence"
  ON report_presence FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "members_upsert_own_report_presence" ON report_presence;
CREATE POLICY "members_upsert_own_report_presence"
  ON report_presence FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "users_update_own_report_presence" ON report_presence;
CREATE POLICY "users_update_own_report_presence"
  ON report_presence FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "users_delete_own_report_presence" ON report_presence;
CREATE POLICY "users_delete_own_report_presence"
  ON report_presence FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- Presence cleanup
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prune_expired_report_presence()
RETURNS INTEGER AS $$
DECLARE deleted INTEGER;
BEGIN
  DELETE FROM report_presence WHERE expires_at < now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('prune_report_presence') WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'prune_report_presence'
    );
    PERFORM cron.schedule(
      'prune_report_presence',
      '* * * * *',
      $cron$SELECT public.prune_expired_report_presence();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available — call prune_expired_report_presence() from your scheduler';
END $$;

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE report_comments;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE report_presence;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMENT ON TABLE report_comments IS 'V5.3 §2.13: threaded admin comments on a report. visible_to_reporter exposes the comment in the reporter feedback loop.';
COMMENT ON TABLE report_presence IS 'V5.3 §2.13: short-TTL presence rows so multiple admins can see who else is on a report. Cleaned every minute.';
