/**
 * FILE: apps/admin/src/lib/useOptimisticMutation.ts
 * PURPOSE: Shared optimistic mutation helper for table/list surfaces.
 */

import { useCallback, useOptimistic, useTransition } from 'react'
import { useToast } from './toast'

interface OptimisticMutationConfig<TItem, TVars> {
  items: TItem[]
  applyLocal: (items: TItem[], vars: TVars) => TItem[]
  request: (vars: TVars) => Promise<{ ok: boolean; error?: { message: string } }>
  describeSuccess: (vars: TVars) => { title: string; description?: string }
  undoRequest?: (vars: TVars) => Promise<{ ok: boolean; error?: { message: string } }>
  describeUndo?: (vars: TVars) => { title: string; description?: string }
}

interface OptimisticMutationResult<TItem, TVars> {
  optimisticItems: TItem[]
  pending: boolean
  run: (vars: TVars) => Promise<void>
}

export function useOptimisticMutation<TItem, TVars>({
  items,
  applyLocal,
  request,
  describeSuccess,
  undoRequest,
  describeUndo,
}: OptimisticMutationConfig<TItem, TVars>): OptimisticMutationResult<TItem, TVars> {
  const toast = useToast()
  // useTransition gives us an Action-aware startTransition. React 19 keeps
  // useOptimistic's optimistic snapshot pinned to `optimisticItems` for as
  // long as an Action passed to startTransition is still pending. The
  // previous implementation wrapped only the synchronous applyOptimistic
  // call in a transition — the transition ended immediately, so the
  // optimistic state reverted to `items` before the server even responded
  // and the row visibly flashed back to its original value.
  const [pending, startTransition] = useTransition()
  const [optimisticItems, applyOptimistic] = useOptimistic(items, applyLocal)

  const run = useCallback(
    (vars: TVars): Promise<void> =>
      new Promise<void>((resolve) => {
        startTransition(async () => {
          try {
            applyOptimistic(vars)
            const res = await request(vars)

            if (!res.ok) {
              toast.error(
                'Change failed',
                res.error?.message ?? 'Mushi restored the server state.',
              )
              return
            }

            const success = describeSuccess(vars)
            toast.success(
              success.title,
              success.description,
              undoRequest
                ? {
                    label: 'Undo',
                    onClick: () => {
                      void undoRequest(vars).then((undoRes) => {
                        if (!undoRes.ok) {
                          toast.error(
                            'Undo failed',
                            undoRes.error?.message ?? 'Refresh the page to reconcile state.',
                          )
                          return
                        }
                        const copy = describeUndo?.(vars) ?? { title: 'Restored' }
                        toast.success(copy.title, copy.description)
                      })
                    },
                  }
                : undefined,
            )
          } finally {
            // Resolving inside `finally` keeps callers' awaits in lock-step
            // with the transition lifecycle — including failures — so the
            // returned promise never hangs.
            resolve()
          }
        })
      }),
    [applyOptimistic, describeSuccess, describeUndo, request, toast, undoRequest],
  )

  return { optimisticItems, pending, run }
}
