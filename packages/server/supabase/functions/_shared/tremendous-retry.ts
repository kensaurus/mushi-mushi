/**
 * FILE: packages/server/supabase/functions/_shared/tremendous-retry.ts
 * PURPOSE: When the gift-card worker stops retrying a Tremendous order
 *          (owner decision 2026-10-10).
 *
 * - 5xx, 408, 425, 429 and network failures stay pending and are retried with
 *   an exponential backoff (1, 2, 4 … minutes, at most 2 hours apart), about
 *   8 hours in all.
 * - Any other 4xx (a bad SKU, a rejected email, an unfunded source) never
 *   succeeds on retry, so it gives up at once.
 * - After MAX_ATTEMPTS failures the order gives up too.
 *
 * Giving up marks the order 'failed' and the redemption 'withheld' with the
 * reason. Points are NOT refunded automatically: ops resolves it from the
 * withheld queue (approve re-sends the order, deny refunds the points).
 *
 * The attempt count lives in tremendous_orders.raw_payload.attempts, so no
 * column is needed; approving a withheld redemption resets it.
 */

export const TREMENDOUS_MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MINUTES = 120;

/** Statuses worth retrying. `null` is a network failure (no response). */
export function isRetryableTremendousStatus(status: number | null): boolean {
  if (status === null) return true;
  if (status >= 500) return true;
  return status === 408 || status === 425 || status === 429;
}

/** Failed attempts recorded on the order so far. */
export function attemptsSoFar(rawPayload: unknown): number {
  const n = (rawPayload as { attempts?: unknown } | null)?.attempts;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Whether a pending order with `attempts` failures is due another try at `now`. */
export function isRetryDue(attempts: number, lastSyncedAt: string | null, now: number): boolean {
  if (attempts <= 0 || !lastSyncedAt) return true;
  const last = Date.parse(lastSyncedAt);
  if (!Number.isFinite(last)) return true;
  const waitMinutes = Math.min(2 ** (attempts - 1), MAX_BACKOFF_MINUTES);
  return now - last >= waitMinutes * 60_000;
}

export type TremendousFailureOutcome =
  | { giveUp: false; attempts: number }
  | { giveUp: true; attempts: number; reason: string };

/** What to do after a failed POST /orders. */
export function onTremendousFailure(status: number | null, previousAttempts: number): TremendousFailureOutcome {
  const attempts = previousAttempts + 1;
  if (!isRetryableTremendousStatus(status)) {
    return { giveUp: true, attempts, reason: `tremendous_rejected_${status}` };
  }
  if (attempts >= TREMENDOUS_MAX_ATTEMPTS) {
    return { giveUp: true, attempts, reason: `tremendous_failed_after_${attempts}_attempts` };
  }
  return { giveUp: false, attempts };
}
