-- Activation cockpit v2 + reporter community loop hardening
-- 1. Reporter-scoped feature votes (SDK widget roadmap)
-- 2. Hot-path indexes for activation + notifications
-- 3. Explicit deny-all RLS on service-only tables

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS reporter_token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_support_tickets_reporter
  ON support_tickets (project_id, reporter_token_hash, created_at DESC)
  WHERE reporter_token_hash IS NOT NULL;

-- ── Reporter feature votes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_request_reporter_votes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reporter_token_hash  TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_frrv_reporter_request
  ON feature_request_reporter_votes (reporter_token_hash, request_id);

CREATE INDEX IF NOT EXISTS idx_frrv_project
  ON feature_request_reporter_votes (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_frrv_request
  ON feature_request_reporter_votes (request_id);

ALTER TABLE feature_request_reporter_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_frrv" ON feature_request_reporter_votes;
CREATE POLICY "service_role_all_frrv"
  ON feature_request_reporter_votes FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- ── Hot-path indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reporter_notifications_unread
  ON reporter_notifications (project_id, reporter_token_hash, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_qa_stories_project_last_run
  ON qa_stories (project_id, last_run_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_feature_board
  ON support_tickets (project_id, category, status, created_at DESC)
  WHERE category = 'feature';

-- ── Service-only tables: explicit deny-all RLS ─────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.jwks_cache') IS NOT NULL THEN
    ALTER TABLE jwks_cache ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "deny_all_jwks_cache" ON jwks_cache;
    CREATE POLICY "deny_all_jwks_cache"
      ON jwks_cache AS RESTRICTIVE FOR ALL
      TO PUBLIC
      USING (FALSE) WITH CHECK (FALSE);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.pipeline_runs') IS NOT NULL THEN
    ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "deny_all_pipeline_runs" ON pipeline_runs;
    CREATE POLICY "deny_all_pipeline_runs"
      ON pipeline_runs AS RESTRICTIVE FOR ALL
      TO PUBLIC
      USING (FALSE) WITH CHECK (FALSE);
  END IF;
END $$;

-- ── Bridge SDK feature reports → support_tickets (idempotent helper) ────────
CREATE OR REPLACE FUNCTION public.mushi_ensure_feature_ticket(
  p_project_id UUID,
  p_reporter_token_hash TEXT,
  p_subject TEXT,
  p_body TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM support_tickets
  WHERE project_id = p_project_id
    AND category = 'feature'
    AND reporter_token_hash = p_reporter_token_hash
    AND subject = p_subject
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO support_tickets (
    project_id,
    category,
    subject,
    body,
    status,
    reporter_token_hash,
    user_email
  ) VALUES (
    p_project_id,
    'feature',
    left(p_subject, 200),
    left(p_body, 4000),
    'open',
    p_reporter_token_hash,
    'reporter@sdk.local'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mushi_ensure_feature_ticket(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mushi_ensure_feature_ticket(UUID, TEXT, TEXT, TEXT) TO service_role;
