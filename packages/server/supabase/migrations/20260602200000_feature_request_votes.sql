-- ============================================================
-- Phase 8: Community-driven feature board
--
-- Promotes 1-to-1 support_tickets (category='feature') into a
-- public, project-scoped board with:
--   1. feature_request_votes  — one vote per user per ticket,
--      enforced by unique index; 23505 on conflict = idempotent.
--   2. feature_request_comments — threaded comments reusing the
--      report_comments RLS pattern (members can read/write; authors
--      own their rows; service_role is omnipotent).
--   3. A permissive cross-user SELECT policy + anon GRANT on both
--      tables so the board is readable without auth (vote/comment
--      still requires authentication).
--   4. A shipped_in_release_id column on support_tickets if not
--      already present (older deployments may lack it).
--
-- Data-pipeline discipline:
--   • Votes are NOT incremented in-place — vote_count is always
--     derived (COUNT(*) on feature_request_votes). No race on an
--     integer counter.
--   • The unique index `uq_frv_user_request` is the idempotency
--     guard; the application handles `unique_violation` (23505)
--     as "already voted, treat as OK".
-- ============================================================

-- ── 0. Ensure support_tickets has shipped_in_release_id ──────────────────────
-- (Some early deployments may not have this column; safe to no-op.)
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS shipped_in_release_id UUID REFERENCES releases(id) ON DELETE SET NULL;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS shipped_note TEXT;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS admin_response TEXT;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS admin_responded_at TIMESTAMPTZ;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- ── 1. feature_request_votes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_request_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The support_tickets row being voted on (category must be 'feature').
  request_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- Voter: must be an authenticated user; NULL disallowed by NOT NULL.
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The project the ticket belongs to — denormalized for fast per-project
  -- aggregation without a JOIN through support_tickets.
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency guard: one vote per (user, ticket). The application MUST
-- catch PostgreSQL error code 23505 and treat it as success (not an error).
CREATE UNIQUE INDEX IF NOT EXISTS uq_frv_user_request
  ON feature_request_votes (user_id, request_id);

CREATE INDEX IF NOT EXISTS idx_frv_request ON feature_request_votes (request_id);
CREATE INDEX IF NOT EXISTS idx_frv_project ON feature_request_votes (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_frv_user    ON feature_request_votes (user_id);

ALTER TABLE feature_request_votes ENABLE ROW LEVEL SECURITY;

-- Service role: unrestricted
DROP POLICY IF EXISTS "service_role_all_frv" ON feature_request_votes;
CREATE POLICY "service_role_all_frv"
  ON feature_request_votes FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- Cross-user SELECT — any authenticated user in the project can see all votes
-- (needed to render vote counts + "did I vote?" state per ticket).
DROP POLICY IF EXISTS "members_read_frv" ON feature_request_votes;
CREATE POLICY "members_read_frv"
  ON feature_request_votes FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

-- Authenticated users can insert their own vote.
DROP POLICY IF EXISTS "members_vote_frv" ON feature_request_votes;
CREATE POLICY "members_vote_frv"
  ON feature_request_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

-- Users can remove only their own vote.
DROP POLICY IF EXISTS "members_delete_own_frv" ON feature_request_votes;
CREATE POLICY "members_delete_own_frv"
  ON feature_request_votes FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Public (anon) read — the board must be viewable without login so
-- operators can share a link with non-members. Data exposure: only
-- aggregate vote counts are shown; individual user_ids are never
-- returned to anon callers.
DROP POLICY IF EXISTS "anon_read_frv" ON feature_request_votes;
CREATE POLICY "anon_read_frv"
  ON feature_request_votes FOR SELECT
  TO anon
  USING (TRUE);

-- Explicit table-level grant so the PostgREST schema cache includes
-- feature_request_votes for anon reads.
GRANT SELECT ON feature_request_votes TO anon;
GRANT SELECT, INSERT, DELETE ON feature_request_votes TO authenticated;

-- ── 2. feature_request_comments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_request_comments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_email   TEXT NOT NULL,
  -- Supports one level of threading (reply to a comment).
  parent_id      UUID REFERENCES feature_request_comments(id) ON DELETE CASCADE,
  body           TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 3000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frc_request  ON feature_request_comments (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_frc_project  ON feature_request_comments (project_id);
CREATE INDEX IF NOT EXISTS idx_frc_author   ON feature_request_comments (author_user_id);

ALTER TABLE feature_request_comments ENABLE ROW LEVEL SECURITY;

-- Service role: unrestricted
DROP POLICY IF EXISTS "service_role_all_frc" ON feature_request_comments;
CREATE POLICY "service_role_all_frc"
  ON feature_request_comments FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- Members can read all comments in their project (same as report_comments).
DROP POLICY IF EXISTS "members_read_frc" ON feature_request_comments;
CREATE POLICY "members_read_frc"
  ON feature_request_comments FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

-- Members can add comments.
DROP POLICY IF EXISTS "members_insert_frc" ON feature_request_comments;
CREATE POLICY "members_insert_frc"
  ON feature_request_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    author_user_id = (SELECT auth.uid())
    AND project_id IN (
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id = (SELECT auth.uid())
    )
  );

-- Authors can edit their own comments.
DROP POLICY IF EXISTS "authors_update_own_frc" ON feature_request_comments;
CREATE POLICY "authors_update_own_frc"
  ON feature_request_comments FOR UPDATE
  TO authenticated
  USING (author_user_id = (SELECT auth.uid()))
  WITH CHECK (author_user_id = (SELECT auth.uid()));

-- Authors can delete their own comments.
DROP POLICY IF EXISTS "authors_delete_own_frc" ON feature_request_comments;
CREATE POLICY "authors_delete_own_frc"
  ON feature_request_comments FOR DELETE
  TO authenticated
  USING (author_user_id = (SELECT auth.uid()));

-- Anon read: same rationale as votes.
DROP POLICY IF EXISTS "anon_read_frc" ON feature_request_comments;
CREATE POLICY "anon_read_frc"
  ON feature_request_comments FOR SELECT
  TO anon
  USING (TRUE);

GRANT SELECT ON feature_request_comments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_request_comments TO authenticated;

-- ── 3. updated_at trigger for feature_request_comments ───────────────────────
CREATE OR REPLACE FUNCTION set_feature_request_comments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frc_updated_at ON feature_request_comments;
CREATE TRIGGER trg_frc_updated_at
  BEFORE UPDATE ON feature_request_comments
  FOR EACH ROW EXECUTE FUNCTION set_feature_request_comments_updated_at();

-- ── 4. Convenience view: feature_requests_with_stats ─────────────────────────
-- Returns feature-category tickets enriched with derived vote count and
-- comment count. Service-role and authenticated both use this view through
-- the edge function (never direct PostgREST access).
CREATE OR REPLACE VIEW feature_requests_with_stats AS
SELECT
  t.id,
  t.project_id,
  t.user_id,
  t.user_email,
  t.subject,
  t.body,
  t.status,
  t.plan_id,
  t.admin_response,
  t.admin_responded_at,
  t.shipped_in_release_id,
  t.shipped_at,
  t.shipped_note,
  t.created_at,
  t.updated_at,
  t.resolved_at,
  COUNT(DISTINCT v.id)::INT AS vote_count,
  COUNT(DISTINCT c.id)::INT AS comment_count
FROM support_tickets t
LEFT JOIN feature_request_votes   v ON v.request_id = t.id
LEFT JOIN feature_request_comments c ON c.request_id = t.id
WHERE t.category = 'feature'
GROUP BY t.id;

GRANT SELECT ON feature_requests_with_stats TO service_role, authenticated;
