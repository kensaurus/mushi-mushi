-- =============================================================================
-- Wave G3: community plugin submission queue.
--
-- `plugin_registry` stays curated — only approved listings appear in the
-- public marketplace. `plugin_submissions` is the intake lane: any
-- authenticated user can submit a plugin proposal via POST
-- /v1/marketplace/submissions. Admins (staff role) triage and either
-- publish to plugin_registry or reject with a reason.
-- =============================================================================

CREATE TABLE IF NOT EXISTS plugin_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  short_description TEXT NOT NULL,
  long_description  TEXT,
  publisher        TEXT,
  source_url       TEXT NOT NULL,
  manifest         JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_scopes  TEXT[] NOT NULL DEFAULT '{}',
  category         TEXT NOT NULL DEFAULT 'other',
  submitted_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending_review'
                     CHECK (status IN ('pending_review', 'approved', 'rejected', 'withdrawn')),
  review_notes     TEXT,
  reviewed_by      UUID REFERENCES auth.users(id),
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE plugin_submissions IS
  'Wave G3 — community-submitted plugin proposals awaiting marketplace curation.';

CREATE INDEX IF NOT EXISTS plugin_submissions_status_idx
  ON plugin_submissions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS plugin_submissions_submitted_by_idx
  ON plugin_submissions (submitted_by);

CREATE UNIQUE INDEX IF NOT EXISTS plugin_submissions_pending_slug_idx
  ON plugin_submissions (slug)
  WHERE status = 'pending_review';

ALTER TABLE plugin_submissions ENABLE ROW LEVEL SECURITY;

-- Submitters can read / insert their own submissions. Staff (admins) manage
-- all rows via the service_role path inside Edge Functions — they're never
-- supposed to SELECT directly from the SQL editor in production.
DROP POLICY IF EXISTS plugin_submissions_owner_select ON plugin_submissions;
CREATE POLICY plugin_submissions_owner_select ON plugin_submissions
  FOR SELECT TO authenticated
  USING (submitted_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS plugin_submissions_owner_insert ON plugin_submissions;
CREATE POLICY plugin_submissions_owner_insert ON plugin_submissions
  FOR INSERT TO authenticated
  WITH CHECK (submitted_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS plugin_submissions_owner_withdraw ON plugin_submissions;
CREATE POLICY plugin_submissions_owner_withdraw ON plugin_submissions
  FOR UPDATE TO authenticated
  USING (submitted_by = (SELECT auth.uid()) AND status = 'pending_review')
  WITH CHECK (submitted_by = (SELECT auth.uid()) AND status IN ('pending_review', 'withdrawn'));

-- Updated-at trigger (matches project convention — see 20260421000000).
CREATE TRIGGER plugin_submissions_set_updated_at
  BEFORE UPDATE ON plugin_submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
