/**
 * FILE: apps/admin/src/components/report-detail/useConfirmedDispatch.tsx
 * PURPOSE: The report page's single way to start a fix. Every control that
 *          dispatches — the triage bar's "Dispatch fix", the recommendation
 *          card's CTA and its "Retry dispatch" actions — calls `request()`,
 *          which applies the same gate (fixed/dismissed, feature request,
 *          preflight, in flight) and opens the same confirm dialog. The card
 *          used to call dispatch directly: one click started a paid agent run
 *          and a PR with no confirm, even with preflight red (2026-10-04
 *          console audit, group B #19).
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { useToast } from '../../lib/toast'
import { dispatchBlock, dispatchConfirmBody } from '../../lib/dispatchConfirm'
import { dispatchSetupSteps, type DispatchSetupSteps } from '../../lib/dispatchSetupSteps'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import type { DispatchTargetRepo } from '../../lib/useDispatchTargetRepo'
import type { ReportDetail } from './types'

/**
 * The gate every dispatch control renders from. `setup` is set only when the
 * dispatch setup is the one thing in the way: the controls then show the
 * steps left as links (DispatchSetupLine), not just a tooltip.
 */
export interface DispatchGate {
  blocked: boolean
  reason: string | null
  setup?: DispatchSetupSteps | null
}

export interface ConfirmedDispatch {
  /** Open the confirm, or explain why a fix cannot be dispatched. */
  request: () => void
  /** The gate every dispatch control renders from. */
  block: DispatchGate
  /** The confirm dialog; render it once on the page. */
  dialog: ReactNode
}

export function useConfirmedDispatch(input: {
  report: ReportDetail
  preflight?: PreflightState
  repoChoice?: DispatchTargetRepo
  busy: boolean
  /** The report's fix PR that is still open (dispatchBlock blocks a second fix). */
  openPr?: { number: number | null } | null
  dispatch: () => void | Promise<void>
}): ConfirmedDispatch {
  const { report, preflight, repoChoice, busy, openPr, dispatch } = input
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const { blocked, reason } = dispatchBlock({ report, preflight, busy, openPr })
  // Setup only: the same gate without the preflight would let the fix go.
  const setupOnly = blocked && Boolean(preflight) && !dispatchBlock({ report, preflight: null, busy, openPr }).blocked
  const checks = preflight?.checks
  const setup = useMemo(() => (setupOnly ? dispatchSetupSteps(checks) : null), [setupOnly, checks])
  // Stable identity while the verdict is unchanged, so memoized consumers
  // (the recommendation card) do not recompute every render.
  const block = useMemo<DispatchGate>(() => (setup ? { blocked, reason, setup } : { blocked, reason }), [blocked, reason, setup])

  const request = useCallback(() => {
    if (blocked) {
      if (reason) toast.info('Fix not dispatched', reason)
      return
    }
    setOpen(true)
  }, [blocked, reason, toast])

  const target = repoChoice?.target
  const dialog = open ? (
    <ConfirmDialog
      title="Dispatch a fix for this report?"
      body={dispatchConfirmBody(
        target
          ? { repoUrl: target.repo_url, baseBranch: target.default_branch }
          : { repoUrl: preflight?.repoUrl, baseBranch: preflight?.baseBranch },
      )}
      confirmLabel="Dispatch fix"
      onCancel={() => setOpen(false)}
      onConfirm={() => {
        setOpen(false)
        void dispatch()
      }}
    />
  ) : null

  return { request, block, dialog }
}
