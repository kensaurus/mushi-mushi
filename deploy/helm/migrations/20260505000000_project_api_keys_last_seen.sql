-- ============================================================
-- Mushi Mushi — SDK heartbeat on project_api_keys
--
-- BEFORE: the `sdk_installed` step in /v1/admin/setup ticked
-- green only when a `reports` row landed with environment.platform
-- != 'mushi-admin'. That conflated three signals into one:
--   1. SDK is wired up
--   2. A real (non-admin) user has triggered a report
--   3. SDK and admin point at the same backend
-- When (3) drifts (e.g. SDK on local Supabase, admin on cloud),
-- the checklist nags forever with zero diagnostic. Even (2) on its
-- own is wrong: a perfectly installed SDK looks broken until a real
-- bug happens.
--
-- AFTER: every authed SDK request (auth via X-Mushi-Api-Key in
-- functions/_shared/auth.ts#apiKeyAuth) updates these columns
-- throttled to one write / 30s / key. The setup endpoint then uses
-- `last_seen_at IS NOT NULL` as the primary `sdk_installed` signal
-- (with the historical report-based check kept as a fallback for
-- pre-heartbeat data) and surfaces the diagnostic fields in the UI
-- so operators can spot cross-backend mismatches immediately.
--
-- Privacy: origin/UA/host are operational metadata, not PII. They
-- come from request headers the SDK already sends to every backend
-- it ever talks to and never include user-supplied content.
-- ============================================================

ALTER TABLE project_api_keys
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_origin TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_endpoint_host TEXT;

COMMENT ON COLUMN project_api_keys.last_seen_at IS
  'Timestamp of the last successful API-key auth from this key (any /v1/* SDK '
  'endpoint). Drives the dashboard sdk_installed checklist + per-key audit UI. '
  'Throttled to one write / 30s in apiKeyAuth so a hot key does not contend.';
COMMENT ON COLUMN project_api_keys.last_seen_origin IS
  'Origin header the SDK most recently sent (e.g. https://glot.it, '
  'http://localhost:3000, capacitor://localhost). Lets the admin warn when '
  'reports are landing here from an unexpected origin.';
COMMENT ON COLUMN project_api_keys.last_seen_user_agent IS
  'User-Agent header the SDK most recently sent. Truncated to 512 chars in '
  'the middleware to keep rows small. Useful for "we see you on Chrome 138 / '
  'iOS Capacitor 6" diagnostics on the setup checklist.';
COMMENT ON COLUMN project_api_keys.last_seen_endpoint_host IS
  'Host portion of the URL the SDK called (e.g. dxptnwrhwsqckaftyymj.supabase.co, '
  'localhost). Recorded server-side from the inbound request URL so the dashboard '
  'can prove "your SDK is reaching THIS backend" — the canonical fix for the '
  '"installed but checklist still red" cross-environment confusion.';

-- Partial index lets the setup endpoint aggregate "any key seen for a project"
-- without scanning revoked / never-used keys. Project lookups dominate; we
-- intentionally do NOT index on last_seen_at alone (no global heartbeat query).
CREATE INDEX IF NOT EXISTS idx_project_api_keys_seen_per_project
  ON project_api_keys (project_id, last_seen_at DESC)
  WHERE last_seen_at IS NOT NULL;
