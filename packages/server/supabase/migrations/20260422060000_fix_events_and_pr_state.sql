-- ============================================================
-- Fix-events stream + pr_state column.
--
-- The `/v1/admin/fixes/:id/timeline` endpoint today synthesises one event
-- per known column on `fix_attempts` (branch / commit_sha / pr_url /
-- check_run_status). That works for a single commit + single CI run, but
-- GitHub branches routinely have:
--   * multiple commits (agent retries after lint fails)
--   * multiple check runs (tests + lint + preview-deploy on the same PR)
--   * PR lifecycle transitions: draft → open → merged / closed
--
-- `fix_events` is the normalised append-only stream the webhook writes one
-- row per GitHub event into. The timeline endpoint prefers it when present
-- and falls back to the synthesised stream (so old attempts still render).
--
-- `fix_attempts.pr_state` stores the separate PR-lifecycle state so the FE
-- can render `merged` / `closed` / `draft` / `open` independently of CI
-- (today we can only infer "success" from check_run_conclusion).
-- ============================================================

-- ------------------------------------------------------------
-- pr_state on fix_attempts
-- ------------------------------------------------------------
ALTER TABLE fix_attempts
  ADD COLUMN IF NOT EXISTS pr_state TEXT
    CHECK (pr_state IS NULL OR pr_state IN ('open','closed','merged','draft'));

COMMENT ON COLUMN fix_attempts.pr_state IS
  'GitHub PR lifecycle state. Updated by webhooks-github-indexer on pull_request events. NULL until the first PR webhook arrives.';

-- ------------------------------------------------------------
-- fix_events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fix_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_attempt_id  UUID NOT NULL REFERENCES fix_attempts(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Mirrors the FixTimelineEvent['kind'] enum on the frontend. New kinds
  -- require a FE update, so this is a plain TEXT check constraint rather
  -- than a pg enum — migrations stay cheap.
  kind            TEXT NOT NULL
    CHECK (kind IN (
      'dispatched','started','branch','commit','pr_opened',
      'ci_started','ci_resolved','pr_state_changed','completed','failed'
    )),
  status          TEXT
    CHECK (status IS NULL OR status IN ('ok','fail','pending')),
  label           TEXT NOT NULL,
  detail          TEXT,
  -- event timestamp (from the webhook payload); we keep created_at for
  -- insertion order / debugging writes.
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- idempotency key so re-delivered webhooks don't duplicate events.
  -- Format: '{event_type}:{identifier}' e.g. 'check_run:8923472382'.
  dedupe_key      TEXT,
  payload         JSONB
);

CREATE INDEX IF NOT EXISTS idx_fix_events_attempt
  ON fix_events (fix_attempt_id, at);
CREATE INDEX IF NOT EXISTS idx_fix_events_project
  ON fix_events (project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fix_events_dedupe
  ON fix_events (fix_attempt_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

COMMENT ON TABLE fix_events IS
  'Append-only stream of GitHub-webhook-derived events per fix_attempt. Powers /v1/admin/fixes/:id/timeline when present (falls back to synthesised events otherwise).';

-- ------------------------------------------------------------
-- RLS — read for project members; writes via service role only.
-- Reads reuse the same owner / member rule as fix_attempts.
-- ------------------------------------------------------------
ALTER TABLE fix_events ENABLE ROW LEVEL SECURITY;

-- Subquery form `(SELECT auth.uid())` is intentional: Postgres caches the
-- result as an initPlan and evaluates it once per query instead of per-row.
-- Bare `auth.uid()` is a documented performance footgun at Supabase scale.
CREATE POLICY fix_events_owner_select ON fix_events
  FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())
    )
    OR project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

-- Writes happen only from the service role (webhook edge function).
-- No write policy means postgres rejects writes from anon / authenticated
-- roles by default — exactly what we want.
