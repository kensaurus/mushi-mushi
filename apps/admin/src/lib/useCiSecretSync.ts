/**
 * FILE: apps/admin/src/lib/useCiSecretSync.ts
 * PURPOSE: React hook for the one-click "Sync CI secrets" action.
 *
 * Mirrors the pattern of useSdkUpgrade.ts but without SSE — the sync-ci-secrets
 * endpoint is synchronous (no long-running worker) and returns the result in a
 * single POST response.
 *
 * Usage:
 *   const { state, sync, reset } = useCiSecretSync(projectId)
 */

import { useCallback, useRef, useState } from 'react'
import { apiFetchMutate } from './supabase'
import type { SyncCiSecretsResult } from './sdkCiSecrets'

export type CiSecretSyncStatus = 'idle' | 'syncing' | 'ok' | 'partial' | 'forbidden' | 'no-repo' | 'failed'

export interface CiSecretSyncState {
  status: CiSecretSyncStatus
  /** The one-time plaintext API key minted on the backend. Show once then discard. */
  rawKey?: string
  keyPrefix?: string
  written?: string[]
  failed?: Array<{ name: string; reason: string }>
  fallback?: SyncCiSecretsResult['fallback']
  errorCode?: string
  errorMessage?: string
}

export function useCiSecretSync(projectId: string) {
  const [state, setState] = useState<CiSecretSyncState>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const sync = useCallback(async () => {
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    setState({ status: 'syncing' })

    // `apiFetchMutate` already unwraps the server's `{ ok, data, error }`
    // envelope: on success `result.data` is the inner SyncCiSecretsResult, and
    // on the soft "forbidden"/"no-repo" cases (HTTP 200 + `ok:false` + `data`)
    // `coerceApiResult` carries that `data` through alongside the error. So we
    // read `result.ok` / `result.data` / `result.error` directly — there is no
    // second envelope to peel.
    const result = await apiFetchMutate<SyncCiSecretsResult>(
      `/v1/admin/projects/${projectId}/sync-ci-secrets`,
      { method: 'POST', body: JSON.stringify({}) },
    )

    if (abort.signal.aborted) return

    const data = result.data
    const code = result.error?.code

    // Full success — individual vars may still have failed (partial write).
    if (result.ok) {
      const failed = data?.failed ?? []
      setState({
        status: failed.length > 0 ? 'partial' : 'ok',
        rawKey: data?.minted?.rawKey,
        keyPrefix: data?.minted?.prefix,
        written: data?.written ?? [],
        failed,
        fallback: data?.fallback,
      })
      return
    }

    // Soft errors below ship a minted key + guided fallback in `data`.
    if (code === 'GH_SECRETS_FORBIDDEN') {
      setState({
        status: 'forbidden',
        rawKey: data?.minted?.rawKey,
        keyPrefix: data?.minted?.prefix,
        written: data?.written ?? [],
        failed: data?.failed ?? [],
        fallback: data?.fallback,
        errorCode: code,
        errorMessage: result.error?.message,
      })
      return
    }

    if (code === 'NO_GITHUB_REPO' || code === 'GH_NO_TOKEN') {
      setState({
        status: 'no-repo',
        rawKey: data?.minted?.rawKey,
        keyPrefix: data?.minted?.prefix,
        fallback: data?.fallback,
        errorCode: code,
        errorMessage: result.error?.message,
      })
      return
    }

    // Hard error (404/403/network/validation) — usually no usable data.
    setState({
      status: 'failed',
      rawKey: data?.minted?.rawKey,
      keyPrefix: data?.minted?.prefix,
      fallback: data?.fallback,
      errorCode: code ?? 'UNKNOWN',
      errorMessage: result.error?.message ?? 'Unknown error from server.',
    })
  }, [projectId])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setState({ status: 'idle' })
  }, [])

  return { state, sync, reset }
}
