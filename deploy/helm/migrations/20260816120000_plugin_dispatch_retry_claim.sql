-- =============================================================================
-- Migration: plugin_dispatch_retry_claim
-- =============================================================================
-- 2026-08-16 resilience audit, findings C1 / C2 / H3 / H4 / H5.
--
-- The `plugin-dispatch-retry` cron fires every minute, but the worker had no
-- claim step: it plain-SELECTed up to 50 `status='pending'` rows whose
-- next_retry_at had elapsed, POSTed them, and only then wrote the new status
-- back. A single tick can run 50 rows / 5 concurrency x 8s timeout = 80s,
-- which is longer than the 60s cadence — so tick N+1 read the *same* rows
-- tick N was still delivering and double-sent every one of them (C1).
--
-- The worker also could not replay the ORIGINAL request: `plugin_dispatch_log`
-- stored only `payload_digest`, so the retry path fabricated a synthetic
-- envelope `{ retryOf, attempt }`. Receivers got a body that did not match the
-- digest, carried none of the original event data, and (because the worker
-- signed only the legacy X-Mushi-* headers) failed Standard Webhooks
-- signature verification outright (C2).
--
-- This migration adds the two columns those fixes need plus an atomic claim:
--
--   * `payload`     — the exact `rawBody` bytes that were signed on the first
--                     dispatch. TEXT, not JSONB, on purpose: (a) jsonb rejects
--                     NUL bytes, which arbitrary event data can contain, and
--                     the dispatch-log insert is wrapped in a swallowing
--                     catch, so a throw here would lose the failure row
--                     entirely; (b) jsonb normalises key order and whitespace,
--                     so a round-trip would no longer hash to `payload_digest`
--                     and the replay would not be byte-exact.
--   * `claimed_at`  — lease stamp. The worker clears it on write-back; a crash
--                     mid-tick leaves it set and the claim function reclaims
--                     the row after the 5-minute lease window.
--   * `'unrecoverable'` status — rows logged before this migration have no
--                     stored payload and can never be replayed faithfully.
--                     The worker marks them terminally instead of sending the
--                     synthetic envelope.
--
-- `claim_plugin_dispatch_retries()` does the select + lease stamp in one
-- statement with FOR UPDATE SKIP LOCKED, so two overlapping ticks are handed
-- disjoint row sets and neither blocks on the other.
--
-- NOTE FOR DEPLOY: apply this migration BEFORE redeploying any edge function
-- that imports `_shared/plugins.ts`. The new `payload` field in deliverOne's
-- dispatch-log insert lands inside `try { … } catch { /* best-effort */ }` —
-- against the old schema the unknown column throws, the catch swallows it,
-- and the failed delivery is never logged at all (no row, no retry).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.plugin_dispatch_log
  ADD COLUMN IF NOT EXISTS payload    TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.plugin_dispatch_log.payload IS
  'Exact rawBody bytes signed on the first dispatch (sha256 = payload_digest). '
  'Replayed verbatim by plugin-dispatch-retry so the receiver sees the original '
  'envelope. TEXT not JSONB: jsonb rejects NUL bytes and normalises key order, '
  'which would break both the insert and the digest tie-back. NULL for rows '
  'written before 20260816120000 — those are terminally ''unrecoverable''.';

COMMENT ON COLUMN public.plugin_dispatch_log.claimed_at IS
  'Lease stamp set by claim_plugin_dispatch_retries(). Cleared by the worker on '
  'write-back; a stale lease (>5 min, i.e. the worker crashed mid-tick) is '
  'reclaimable. NULL means the row is free to claim.';

-- -----------------------------------------------------------------------------
-- 2. Allow the terminal 'unrecoverable' status
-- -----------------------------------------------------------------------------
-- The original CHECK in 20260418001700 was unnamed, so Postgres auto-named it
-- `plugin_dispatch_log_status_check`. Drop-if-exists then re-add under the same
-- (now explicit) name keeps this migration re-runnable.
ALTER TABLE public.plugin_dispatch_log
  DROP CONSTRAINT IF EXISTS plugin_dispatch_log_status_check;

ALTER TABLE public.plugin_dispatch_log
  ADD CONSTRAINT plugin_dispatch_log_status_check
  CHECK (status IN ('pending', 'ok', 'error', 'timeout', 'skipped', 'unrecoverable'));

-- -----------------------------------------------------------------------------
-- 3. Atomic claim
-- -----------------------------------------------------------------------------
-- Predicate is covered by the existing partial index
--   idx_plugin_dispatch_pending ON (status, next_retry_at) WHERE status = 'pending'
-- so no new index is needed.
CREATE OR REPLACE FUNCTION public.claim_plugin_dispatch_retries(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id             bigint,
  delivery_id    uuid,
  project_id     uuid,
  plugin_slug    text,
  event          text,
  attempt        integer,
  payload        text,
  payload_digest text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimable AS (
    SELECT d.id
    FROM   public.plugin_dispatch_log d
    WHERE  d.status = 'pending'
      AND  d.next_retry_at IS NOT NULL
      AND  d.next_retry_at <= now()
      -- Free, or leased by a worker that never came back.
      AND  (d.claimed_at IS NULL OR d.claimed_at < now() - interval '5 minutes')
    ORDER  BY d.next_retry_at
    LIMIT  GREATEST(COALESCE(p_limit, 50), 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.plugin_dispatch_log d
  SET    claimed_at = now()
  FROM   claimable c
  WHERE  d.id = c.id
  RETURNING d.id, d.delivery_id, d.project_id, d.plugin_slug,
            d.event, d.attempt, d.payload, d.payload_digest;
$$;

COMMENT ON FUNCTION public.claim_plugin_dispatch_retries(integer) IS
  'Atomically leases up to p_limit due plugin_dispatch_log retries and returns '
  'them with the original signed payload. FOR UPDATE SKIP LOCKED means two '
  'overlapping plugin-dispatch-retry ticks get disjoint sets instead of '
  'double-sending the same deliveries (2026-08-16 audit C1). Leases older than '
  '5 minutes are reclaimed so a crashed worker cannot strand rows.';

REVOKE EXECUTE ON FUNCTION public.claim_plugin_dispatch_retries(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_plugin_dispatch_retries(integer) TO service_role;
