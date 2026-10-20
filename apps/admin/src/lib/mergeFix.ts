/**
 * Console-initiated PR merge — calls POST /v1/admin/fixes/:id/merge.
 * User-confirmed; same post-merge bookkeeping as the GitHub webhook.
 */

import { apiFetch } from './supabase'

export type MergeMethod = 'merge' | 'squash' | 'rebase'

export interface MergeFixResult {
  ok: boolean
  reportStatus?: string | null
  alreadyMerged?: boolean
  error?: string
  /** Server error code; `REVIEW_HOLD` when the Opus review says hold (ADR 0030). */
  code?: string
}

export async function mergeFixAttempt(
  fixId: string,
  mergeMethod: MergeMethod = 'squash',
  opts: { override?: boolean; overrideReason?: string; confirmPendingReview?: boolean } = {},
): Promise<MergeFixResult> {
  const res = await apiFetch<{
    merged?: boolean
    alreadyMerged?: boolean
    reportStatus?: string | null
  }>(`/v1/admin/fixes/${fixId}/merge`, {
    method: 'POST',
    body: JSON.stringify({
      mergeMethod,
      ...(opts.override ? { override: true } : {}),
      ...(opts.overrideReason ? { overrideReason: opts.overrideReason } : {}),
      ...(opts.confirmPendingReview ? { confirmPendingReview: true } : {}),
    }),
  })

  if (!res.ok) {
    return {
      ok: false,
      error: res.error?.message ?? 'Merge failed',
      code: res.error?.code,
    }
  }

  return {
    ok: true,
    reportStatus: res.data?.reportStatus ?? null,
    alreadyMerged: res.data?.alreadyMerged,
  }
}

export type MergeEligibleFix = {
  pr_url?: string | null
  pr_number?: number | null
  pr_state?: string | null
  status?: string
  merged_at?: string | null
}

/** PR landed on the default branch — console merge is closed and filters should treat the loop as shipped. */
export function isFixMerged(fix: MergeEligibleFix): boolean {
  return fix.pr_state === 'merged' || fix.status === 'merged' || Boolean(fix.merged_at)
}

export function canMergeFix(fix: MergeEligibleFix): boolean {
  return getMergeBlockerReason(fix) === null
}

/**
 * Human-readable reason when console merge is unavailable — drives bulk-bar hints and per-card affordances.
 * @internal Exported for tests only.
 */
export function getMergeBlockerReason(fix: MergeEligibleFix): string | null {
  if (!fix.pr_url) return 'No pull request opened yet'
  if (!fix.pr_number) return 'PR number missing — refresh CI or open on GitHub'
  if (isFixMerged(fix)) return 'Already merged on GitHub'
  if (fix.pr_state === 'closed') return 'PR was closed without merging — reopen it on GitHub or dispatch a new fix'
  if (fix.status !== 'completed' && fix.status !== 'merged') {
    return `Attempt status is “${fix.status ?? 'unknown'}” — only completed attempts can merge from the console`
  }
  return null
}

/** Pick the fix attempt the UI should treat as "current" — not always [0]
 *  when a later failed retry exists after a successful PR open. */
export function pickPrimaryFixAttempt<
  T extends {
    status?: string
    pr_url?: string | null
    pr_number?: number | null
    pr_state?: string | null
    merged_at?: string | null
  },
>(attempts: T[] | undefined | null): T | undefined {
  if (!attempts?.length) return undefined
  const mergeable = attempts.find((a) => canMergeFix(a))
  if (mergeable) return mergeable
  const withOpenPr = attempts.find((a) => a.pr_url && a.status === 'completed' && a.pr_state !== 'closed')
  if (withOpenPr) return withOpenPr
  const inFlight = attempts.find((a) =>
    ['queued', 'running', 'dispatched'].includes(a.status ?? ''),
  )
  if (inFlight) return inFlight
  return attempts[0]
}
