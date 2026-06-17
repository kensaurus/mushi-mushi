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
import type { SyncCiSecretsResponse, SyncCiSecretsResult } from './sdkCiSecrets'

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

    const result = await apiFetchMutate<SyncCiSecretsResponse>(
      `/v1/admin/projects/${projectId}/sync-ci-secrets`,
      { method: 'POST', body: JSON.stringify({}) },
    )

    if (abort.signal.aborted) return

    if (!result.ok) {
      setState({
        status: 'failed',
        errorCode: 'FETCH_ERROR',
        errorMessage: result.error?.message ?? 'Network error',
      })
      return
    }

    const body = result.data as SyncCiSecretsResponse | undefined
    if (!body) {
      setState({ status: 'failed', errorCode: 'EMPTY_RESPONSE', errorMessage: 'No response from server.' })
      return
    }

    const data = body.data
    const code = body.error?.code

    if (!body.ok && code === 'GH_SECRETS_FORBIDDEN') {
      setState({
        status: 'forbidden',
        rawKey: data?.minted.rawKey,
        keyPrefix: data?.minted.prefix,
        written: data?.written ?? [],
        failed: data?.failed ?? [],
        fallback: data?.fallback,
        errorCode: code,
        errorMessage: body.error?.message,
      })
      return
    }

    if (!body.ok && (code === 'NO_GITHUB_REPO' || code === 'GH_NO_TOKEN')) {
      setState({
        status: 'no-repo',
        rawKey: data?.minted.rawKey,
        keyPrefix: data?.minted.prefix,
        fallback: data?.fallback,
        errorCode: code,
        errorMessage: body.error?.message,
      })
      return
    }

    if (!body.ok) {
      setState({
        status: 'failed',
        rawKey: data?.minted.rawKey,
        keyPrefix: data?.minted.prefix,
        fallback: data?.fallback,
        errorCode: code ?? 'UNKNOWN',
        errorMessage: body.error?.message ?? 'Unknown error from server.',
      })
      return
    }

    // Partial success: some written, some failed.
    const failed = data?.failed ?? []
    setState({
      status: failed.length > 0 ? 'partial' : 'ok',
      rawKey: data?.minted.rawKey,
      keyPrefix: data?.minted.prefix,
      written: data?.written ?? [],
      failed,
      fallback: data?.fallback,
    })
  }, [projectId])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setState({ status: 'idle' })
  }, [])

  return { state, sync, reset }
}
