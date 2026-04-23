/**
 * FILE: apps/admin/src/lib/useUndoableBulk.ts
 * PURPOSE: Wave T.2.4b — wrap a bulk mutation so success produces an "Undo"
 *          toast that, when clicked, posts to /v1/admin/reports/bulk/:id/undo
 *          and restores the prior_state on the backend.
 *
 * DESIGN NOTES:
 *   - This hook is intentionally thin: it doesn't own the bulk call shape,
 *     it just takes the mutation_id out of the `ApiResult` and wires an
 *     action slot onto `toast.success`.
 *   - Undo is fire-and-forget from the component's perspective — success
 *     triggers a second success toast ("Undone · N reports restored") and
 *     forces a reload so the UI rehydrates from authoritative state. If
 *     the undo fails (expired / already-undone) we surface the server's
 *     error message so the operator knows to retry manually.
 *   - We don't add any local "optimistic revert" because the operator is
 *     still looking at the post-apply UI when they click Undo; the round
 *     trip + reload is fast enough that flickering optimistic state would
 *     be a net loss.
 */

import { useCallback } from 'react'
import { apiFetch } from './supabase'
import { useToast } from './toast'

export interface BulkApplyResult {
  /** The mutation id returned by /v1/admin/reports/bulk, or null when the
   *  backend couldn't log the mutation (undo will be unavailable). */
  mutationId: string | null
  /** Number of reports the apply actually updated. */
  affected: number
}

export interface UndoableBulkOptions {
  /** Toast title for the success case. Example: "Dismissed". */
  successTitle: string
  /** Descriptive suffix — typically "N reports updated". */
  successDescription: string
  /** Called after a successful apply *and* after a successful undo, so the
   *  consumer can refresh its list from authoritative state. */
  onReload: () => void
}

export function useUndoableBulk() {
  const toast = useToast()

  const announce = useCallback(
    (result: BulkApplyResult, opts: UndoableBulkOptions) => {
      if (result.mutationId) {
        toast.success(opts.successTitle, opts.successDescription, {
          label: 'Undo',
          onClick: async () => {
            const res = await apiFetch<{ mutation_id: string; restored: number }>(
              `/v1/admin/reports/bulk/${result.mutationId}/undo`,
              { method: 'POST' },
            )
            if (!res.ok) {
              toast.error('Undo failed', res.error?.message ?? 'Unknown error')
              return
            }
            const restored = res.data?.restored ?? 0
            toast.info(
              'Undone',
              `${restored} ${restored === 1 ? 'report' : 'reports'} restored`,
            )
            opts.onReload()
          },
        })
        return
      }
      // No mutation_id → the backend didn't log the bulk apply (table
      // missing / insert failed). We still confirm the apply succeeded but
      // omit the Undo action rather than showing a broken affordance.
      toast.success(opts.successTitle, opts.successDescription)
    },
    [toast],
  )

  return { announce }
}
