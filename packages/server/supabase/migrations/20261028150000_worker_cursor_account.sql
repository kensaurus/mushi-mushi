-- ============================================================================
-- 20261028150000_worker_cursor_account
--
-- "Switch account" for a local worker from the console (ADR 0048 amendment
-- 2026-10-28). On 2026-10-28 the owner moved the lanes from one Cursor account
-- to another by hand in a terminal; the Workers tab now does it:
--
--   work_hosts.cursor_account            the Cursor account the machine's lanes
--                                        may spend, named by the machine's
--                                        owner in the console. Sent to the
--                                        daemon in the heartbeat answer; it
--                                        overrides the local worker.json. Shown
--                                        in full only to the owner, masked to
--                                        everyone else.
--   work_hosts.cursor_login_requested_at when the owner last asked for a switch.
--   work_hosts.cursor_login              where that switch stands: requestId,
--                                        state (requested, waiting_for_runs,
--                                        link_ready, signed_in, wrong_account,
--                                        failed, expired), account, times, a
--                                        cleaned detail, and the Cursor approve
--                                        link only while state = link_ready.
--
-- No key or password is stored or sent: the person signs in on cursor.com.
-- The approve link is read only by GET /v1/admin/work/hosts/:id/cursor-login
-- for the machine's owner; never by /work/lanes, the badge, MCP or audit rows.
--
-- ADDITIVE: three nullable columns. Safe before or after deploying api-ext:
-- the heartbeat reads them on their own and treats missing columns as "no
-- account set"; the switch routes answer 409 MIGRATION_PENDING until they
-- exist. RLS is unchanged (work_hosts stays service role only).
-- ============================================================================

ALTER TABLE public.work_hosts
  ADD COLUMN IF NOT EXISTS cursor_account text
    CHECK (cursor_account IS NULL OR (char_length(cursor_account) <= 254 AND cursor_account ~ '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')),
  ADD COLUMN IF NOT EXISTS cursor_login_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cursor_login jsonb
    CHECK (cursor_login IS NULL OR (jsonb_typeof(cursor_login) = 'object' AND pg_column_size(cursor_login) <= 8192));

COMMENT ON COLUMN public.work_hosts.cursor_account IS
  'The Cursor account this machine''s lanes may spend, named by the machine''s owner in the console (ADR 0048 amendment 2026-10-28). Overrides the local worker.json; shown in full only to the owner.';
COMMENT ON COLUMN public.work_hosts.cursor_login_requested_at IS
  'When the machine''s owner last asked for a Cursor account switch from the console.';
COMMENT ON COLUMN public.work_hosts.cursor_login IS
  'Where the Cursor account switch stands (requestId, state, account, times, detail). The approve link is kept only while state = link_ready and is read only by the machine''s owner. Never a key or password.';
