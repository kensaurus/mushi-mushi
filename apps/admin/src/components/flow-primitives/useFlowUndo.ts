/**
 * FILE: apps/admin/src/components/flow-primitives/useFlowUndo.ts
 * PURPOSE: Tiny hook that wraps a mutation with an undo window. Calls the
 *          mutation optimistically after a short grace period (5s by
 *          default) during which the user can click "Undo" on the toast
 *          to cancel it. On error, the mutation is rolled back and an
 *          error toast is shown.
 *
 *          Mirrors the "Gmail archive" pattern — immediate optimistic UI
 *          for power users, safety net for the rest.
 */

import { useCallback, useRef } from 'react'
import { useToast } from '../../lib/toast'

interface UndoableAction {
  /** Toast copy shown during the undo window. */
  message: string
  /** Description shown under the message. */
  description?: string
  /** The work to perform after the grace period (typically an apiFetch). */
  run: () => Promise<{ ok: boolean; error?: string }>
  /** Optimistic UI preview — called immediately. */
  onOptimistic?: () => void
  /** Undo the optimistic UI. Called if the user clicks Undo or `run()` fails. */
  onRollback?: () => void
  /** Fired when the remote mutation resolves successfully (post-grace). */
  onCommitted?: () => void
  /** Grace period in ms. Default 5000. */
  graceMs?: number
}

export function useFlowUndo() {
  const toast = useToast()
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; cancel: () => void } | null>(null)

  const trigger = useCallback(
    (action: UndoableAction) => {
      if (pending.current) {
        clearTimeout(pending.current.timer)
        pending.current = null
      }
      action.onOptimistic?.()
      let cancelled = false
      const cancel = () => {
        cancelled = true
        action.onRollback?.()
      }
      const timer = setTimeout(async () => {
        pending.current = null
        if (cancelled) return
        try {
          const res = await action.run()
          if (!res.ok) {
            action.onRollback?.()
            toast.error('Action failed', res.error ?? 'The change was reverted.')
            return
          }
          action.onCommitted?.()
        } catch (err) {
          action.onRollback?.()
          toast.error('Action failed', err instanceof Error ? err.message : 'The change was reverted.')
        }
      }, action.graceMs ?? 5000)
      pending.current = { timer, cancel }
      toast.push({
        tone: 'info',
        title: action.message,
        description: action.description,
        duration: action.graceMs ?? 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            if (pending.current) {
              clearTimeout(pending.current.timer)
              pending.current.cancel()
              pending.current = null
            }
          },
        },
      })
    },
    [toast],
  )

  return { trigger }
}
