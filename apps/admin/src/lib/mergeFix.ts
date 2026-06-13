/**
 * Console-initiated PR merge — calls POST /v1/admin/fixes/:id/merge.
 * User-confirmed; same post-merge bookkeeping as the GitHub webhook.
 */

import { useCallback, useState } from 'react'
import { apiFetch } from './supabase'

export type MergeMethod = 'merge' | 'squash' | 'rebase'

export type MergeStatus = 'idle' | 'merging' | 'merged' | 'failed'

export interface MergeState {
  status: MergeStatus
  error?: string
  reportStatus?: string | null
  alreadyMerged?: boolean
}

export interface MergeFixResult {
  ok: boolean
  reportStatus?: string | null
  alreadyMerged?: boolean
  error?: string
}

export async function mergeFixAttempt(
  fixId: string,
  mergeMethod: MergeMethod = 'squash',
): Promise<MergeFixResult> {
  const res = await apiFetch<{
    merged?: boolean
    alreadyMerged?: boolean
    reportStatus?: string | null
  }>(`/v1/admin/fixes/${fixId}/merge`, {
    method: 'POST',
    body: JSON.stringify({ mergeMethod }),
  })

  if (!res.ok) {
    return {
      ok: false,
      error: res.error?.message ?? 'Merge failed',
    }
  }

  return {
    ok: true,
    reportStatus: res.data?.reportStatus ?? null,
    alreadyMerged: res.data?.alreadyMerged,
  }
}

export function canMergeFix(fix: {
  pr_url?: string | null
  pr_number?: number | null
  pr_state?: string | null
  status?: string
  merged_at?: string | null
}): boolean {
  if (!fix.pr_url || !fix.pr_number) return false
  if (fix.pr_state === 'merged' || fix.merged_at) return false
  if (fix.status !== 'completed' && fix.status !== 'merged') return false
  return true
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
  const withOpenPr = attempts.find((a) => a.pr_url && a.status === 'completed')
  if (withOpenPr) return withOpenPr
  const inFlight = attempts.find((a) =>
    ['queued', 'running', 'dispatched'].includes(a.status ?? ''),
  )
  if (inFlight) return inFlight
  return attempts[0]
}

export function useMergeFix(fixId: string | undefined) {
  const [state, setState] = useState<MergeState>({ status: 'idle' })

  const merge = useCallback(
    async (mergeMethod: MergeMethod = 'squash') => {
      if (!fixId) {
        setState({ status: 'failed', error: 'No fix selected' })
        return false
      }
      setState({ status: 'merging' })
      const result = await mergeFixAttempt(fixId, mergeMethod)
      if (!result.ok) {
        setState({ status: 'failed', error: result.error })
        return false
      }
      setState({
        status: 'merged',
        reportStatus: result.reportStatus,
        alreadyMerged: result.alreadyMerged,
      })
      return true
    },
    [fixId],
  )

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, merge, reset }
}
