-- ============================================================================
-- 20260922000013_api_key_browser_seen
--
-- project_api_keys.browser_seen_at: when a web page first sent this key.
--
-- A key a browser sends is public (anyone can read it from the bundle). The
-- api refuses mcp:* use of such keys (_shared/auth.ts mcpKeyBrowserExposure).
-- last_seen_origin cannot carry that on its own: every SDK heartbeat
-- overwrites it, and an origin-less call (a script, a server) sets it back to
-- null. This column is set once by the heartbeat and never cleared. No
-- backfill: the check also honours last_seen_origin while it is set.
-- ============================================================================

alter table public.project_api_keys
  add column if not exists browser_seen_at timestamptz;

comment on column public.project_api_keys.browser_seen_at is
  'First time a browser (Origin/Referer present) sent this key. Sticky. Keys with this set cannot use mcp:* scopes.';
