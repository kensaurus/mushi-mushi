/**
 * FILE: apps/admin/src/lib/useKensaurusOps.ts
 * PURPOSE: Read and write the kensaurus-ops snapshot for /providers through
 *          GET/POST /v1/admin/kensaurus/ops. The snapshot is held in local
 *          state (not usePageData) so a write can await the fresh read inside
 *          the same transition: useOptimistic then lets go of the optimistic
 *          value only once the new snapshot is in, never in between.
 */

import { startTransition, useCallback, useEffect, useState } from 'react'
import { apiFetch, apiFetchMutate, type ApiResult } from './supabase'
import type { OpsAction, OpsReadResponse, OpsWriteResponse } from './kensaurusOpsTypes'

export interface KensaurusOpsState {
  data: OpsReadResponse | null
  error: { code: string; message: string } | null
  loading: boolean
  refreshing: boolean
}

export function useKensaurusOps() {
  const [state, setState] = useState<KensaurusOpsState>({ data: null, error: null, loading: true, refreshing: false })

  /** Read the snapshot; `fresh` skips the server's 60 s hold. Resolves to the read, or null when it failed. */
  const load = useCallback(async (fresh: boolean): Promise<OpsReadResponse | null> => {
    setState((s) => ({ ...s, refreshing: true }))
    const path = fresh ? '/v1/admin/kensaurus/ops?fresh=1' : '/v1/admin/kensaurus/ops'
    const res = await apiFetch<OpsReadResponse>(path, { scope: 'none', cache: 'no-store' })
    // A transition, so a write's optimistic value holds until this lands.
    startTransition(() => {
      setState((s) =>
        res.ok && res.data
          ? { data: res.data, error: null, loading: false, refreshing: false }
          : { ...s, error: res.error ?? { code: 'ERROR', message: 'Request failed' }, loading: false, refreshing: false },
      )
    })
    return res.ok && res.data ? res.data : null
  }, [])

  const write = useCallback(
    (action: OpsAction): Promise<ApiResult<OpsWriteResponse>> =>
      apiFetchMutate<OpsWriteResponse>('/v1/admin/kensaurus/ops', { method: 'POST', body: JSON.stringify(action), scope: 'none' }),
    [],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  return { ...state, load, write }
}
