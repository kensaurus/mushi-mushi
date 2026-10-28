-- ============================================================================
-- 20261028120000_worker_recheck
--
-- Worker visibility (ADR 0048 amendment 2026-10-28). On 2026-10-28 the Cursor
-- account check (`cursor-agent status`) timed out on a machine under load 37
-- on 16 cores, and nothing in the console said so. The worker now reports
-- the check's result, its age and a masked detail in work_hosts.status, and
-- the Workers tab offers "Re-check the account".
--
--   work_hosts.recheck_requested_at   when the machine's owner asked for a new
--                                     check (POST /v1/admin/work/hosts/:id/recheck).
--                                     The heartbeat answer carries
--                                     `recheckAccount: true` while the request
--                                     is newer than the machine's last check
--                                     (at most 30 minutes). A value, never a
--                                     command: the daemon runs the same
--                                     `cursor-agent status` it always runs.
--
-- Everything else the flags need (the stage of each run, its last log lines,
-- which lane holds each agent space, gh sign-in, load) is telemetry in the
-- existing status jsonb columns; hook failures are read from
-- work_claims.detail.
--
-- ADDITIVE: one nullable column. Safe before or after deploying api-ext: the
-- heartbeat reads the column on its own and treats a missing column as "not
-- asked"; the recheck route answers 409 MIGRATION_PENDING until it exists.
-- RLS is unchanged (work_hosts stays service role only).
-- ============================================================================

ALTER TABLE public.work_hosts
  ADD COLUMN IF NOT EXISTS recheck_requested_at timestamptz;

COMMENT ON COLUMN public.work_hosts.recheck_requested_at IS
  'When the machine''s owner asked for a new Cursor account check from the console (ADR 0048 amendment 2026-10-28). The heartbeat answers recheckAccount: true while this is newer than the machine''s last check, for at most 30 minutes.';
