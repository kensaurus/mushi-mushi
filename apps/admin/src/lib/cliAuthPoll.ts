/**
 * FILE: apps/admin/src/lib/cliAuthPoll.ts
 * PURPOSE: What /cli-auth does with one "did my terminal pick the token up?"
 *          poll result, after the code was already approved.
 *
 * QA bug 268: a single poll error (a network blip) flipped the page to "Couldn't
 * approve CLI connection" with a "Retry approve" button, for a code that was
 * already approved; retrying then failed with "No pending request". A
 * transient failure now keeps waiting; only a real end state stops it, and
 * that end state never offers to approve again.
 */

export type ClaimPollOutcome =
  | { kind: 'connected' }
  | { kind: 'keep-waiting'; transient: boolean }
  | { kind: 'ended'; message: string }

/**
 * What to show when approve answered NOT_FOUND ("no pending request"). The
 * code is often not gone at all: it was approved already, in another tab or
 * by an earlier click, and the terminal has its key (2026-11-11: the owner
 * saw "Couldn't approve" while `mushi login` printed "Approved!"). Ask the
 * status of the same code before showing an error.
 * - claimed: the terminal is connected, so say so;
 * - approved, not claimed yet: wait for the terminal like after a click;
 * - anything else (expired, rejected, unknown): the original error stands.
 */
export function afterApproveNotFound(
  status: { ok: boolean; data?: { status?: string; claimed?: boolean } | null } | null,
): 'connected' | 'waiting' | 'error' {
  if (!status?.ok) return 'error'
  if (status.data?.claimed) return 'connected'
  if (status.data?.status === 'approved') return 'waiting'
  return 'error'
}

export function interpretClaimPoll(
  res: { ok: boolean; data?: { status?: string; claimed?: boolean } | null; error?: { code?: string } | null } | null,
): ClaimPollOutcome {
  if (!res) return { kind: 'keep-waiting', transient: true }
  if (res.ok) {
    if (res.data?.claimed) return { kind: 'connected' }
    if (res.data?.status === 'expired') {
      return {
        kind: 'ended',
        message: 'This request expired before your terminal picked it up. Re-run the command and approve the newest tab.',
      }
    }
    if (res.data?.status === 'rejected') {
      return { kind: 'ended', message: 'This request was denied. Run the command again to get a fresh code.' }
    }
    return { kind: 'keep-waiting', transient: false }
  }
  if (res.error?.code === 'NOT_FOUND') {
    return {
      kind: 'ended',
      message: 'This request could not be found — it may have expired. Re-run the command and try again.',
    }
  }
  // Network, 5xx, rate limit: the approval stands; try again on the next tick.
  return { kind: 'keep-waiting', transient: true }
}
