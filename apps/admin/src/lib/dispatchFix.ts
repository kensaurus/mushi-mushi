/**
 * FILE: apps/admin/src/lib/dispatchFix.ts
 * PURPOSE: React hook for dispatching agentic fixes (V5.3 §2.10, M5+M8).
 *          Subscribes to the SSE stream when available, falls back to polling
 *          if the stream errors (so older Edge Function deployments still work).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, supabase } from './supabase'
import { RESOLVED_API_URL } from './env'
import { openSseStream } from './sseClient'
import { withAguiHandler } from './agui'

export type DispatchStatus = 'idle' | 'queueing' | 'queued' | 'running' | 'completed' | 'failed'

export interface DispatchState {
  status: DispatchStatus
  dispatchId?: string
  prUrl?: string
  error?: string
}

interface DispatchResponse {
  dispatchId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  pr_url?: string | null
  error?: string | null
}

interface StatusEventPayload {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  fixAttemptId?: string
  prUrl?: string | null
  error?: string | null
}

const POLL_INTERVAL_MS = 2_500
const POLL_MAX_MS = 10 * 60 * 1000

export function useDispatchFix(reportId: string, projectId: string) {
  const [state, setState] = useState<DispatchState>({ status: 'idle' })
  const cancelled = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  // Tracks whether a terminal SSE event arrived for the current dispatch.
  // Reset on each dispatch() call so onClose can decide whether to fall back
  // to polling. Without this, a normal stream end (server restart, idle LB
  // timeout, deploy) leaves the UI stuck on 'queued'/'running' forever.
  const reachedTerminal = useRef(false)

  useEffect(() => () => {
    cancelled.current = true
    abortRef.current?.abort()
  }, [])

  const poll = useCallback(async (dispatchId: string, startedAt: number) => {
    if (cancelled.current) return
    if (Date.now() - startedAt > POLL_MAX_MS) {
      setState(s => ({ ...s, status: 'failed', error: 'Dispatch timed out (>10 min)' }))
      return
    }
    const res = await apiFetch<DispatchResponse>(`/v1/admin/fixes/dispatch/${dispatchId}`)
    if (!res.ok || !res.data) {
      setState(s => ({ ...s, status: 'failed', error: 'Failed to fetch dispatch status' }))
      return
    }
    if (res.data.status === 'completed') {
      reachedTerminal.current = true
      setState({ status: 'completed', dispatchId, prUrl: res.data.pr_url ?? undefined })
      return
    }
    if (res.data.status === 'failed' || res.data.status === 'cancelled') {
      reachedTerminal.current = true
      setState({ status: 'failed', dispatchId, error: res.data.error ?? `Dispatch ${res.data.status}` })
      return
    }
    setState(s => ({ ...s, status: res.data!.status as DispatchStatus, dispatchId }))
    setTimeout(() => poll(dispatchId, startedAt), POLL_INTERVAL_MS)
  }, [])

  const subscribeStream = useCallback(async (dispatchId: string) => {
    if (cancelled.current) return
    const { data: session } = await supabase.auth.getSession()
    const bearer = session.session?.access_token
    if (!bearer) {
      poll(dispatchId, Date.now())
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // Guard against double-polling. Even though `openSseStream` now uses
    // `onClose` as its single closure signal, an unexpected throw (bug in the
    // event parser, a downstream consumer mutation, etc.) could still trigger
    // both `onClose` and the catch block. Two parallel poll() loops for the
    // same dispatchId would double the API rate and cause UI flicker.
    let pollStarted = false
    const startPolling = () => {
      if (pollStarted || cancelled.current || reachedTerminal.current) return
      pollStarted = true
      poll(dispatchId, Date.now())
    }
    try {
      await openSseStream({
        url: `${RESOLVED_API_URL}/v1/admin/fixes/dispatch/${dispatchId}/stream`,
        bearer,
        signal: ctrl.signal,
        onEvent: withAguiHandler(
          (env) => {
            if (cancelled.current) return
            switch (env.type) {
              case 'run.status': {
                const payload = env.payload as { status: string }
                if (payload?.status) {
                  setState(s => ({ ...s, status: payload.status as DispatchStatus, dispatchId }))
                }
                break
              }
              case 'run.completed': {
                const payload = env.payload as { output?: { prUrl?: string | null } }
                reachedTerminal.current = true
                setState({ status: 'completed', dispatchId, prUrl: payload?.output?.prUrl ?? undefined })
                break
              }
              case 'run.failed': {
                const payload = env.payload as { code?: string; message?: string }
                reachedTerminal.current = true
                setState({ status: 'failed', dispatchId, error: payload?.message ?? payload?.code ?? 'Failed' })
                break
              }
              default:
                break
            }
          },
          (e) => {
            if (cancelled.current) return
            if (e.event === 'status') {
              try {
                const p = JSON.parse(e.data) as StatusEventPayload
                if (p.status === 'completed') {
                  reachedTerminal.current = true
                  setState({ status: 'completed', dispatchId, prUrl: p.prUrl ?? undefined })
                } else if (p.status === 'failed' || p.status === 'cancelled') {
                  reachedTerminal.current = true
                  setState({ status: 'failed', dispatchId, error: p.error ?? `Dispatch ${p.status}` })
                } else {
                  setState(s => ({ ...s, status: p.status as DispatchStatus, dispatchId }))
                }
              } catch {
                // malformed payload — ignore, rely on next event
              }
            }
          },
        ),
        onClose: (reason, err) => {
          if (cancelled.current || reachedTerminal.current) return
          // 'abort' means the user (or unmount) cancelled — never fall back.
          // Both 'error' AND 'end' need polling fallback: a normal close before
          // a terminal event (server restart, LB idle timeout, deploy) would
          // otherwise leave the UI stuck on 'queued'/'running' forever.
          if (reason === 'abort') return
          const detail = reason === 'error'
            ? (err instanceof Error ? err.message : String(err))
            : 'stream closed normally before terminal event'
          console.warn(`SSE stream closed (${reason}): ${detail} — falling back to polling`)
          startPolling()
        },
      })
    } catch {
      startPolling()
    }
  }, [poll])

  const dispatch = useCallback(async () => {
    cancelled.current = false
    reachedTerminal.current = false
    setState({ status: 'queueing' })
    const res = await apiFetch<{ dispatchId: string; status: string; createdAt: string }>(
      '/v1/admin/fixes/dispatch',
      { method: 'POST', body: JSON.stringify({ reportId, projectId }) },
    )
    if (!res.ok || !res.data) {
      const code = (res as { error?: { code?: string; message?: string } }).error?.code ?? 'DISPATCH_FAILED'
      const message = (res as { error?: { code?: string; message?: string } }).error?.message ?? 'Could not dispatch fix'
      setState({ status: 'failed', error: `${code}: ${message}` })
      return
    }
    const { dispatchId } = res.data
    setState({ status: 'queued', dispatchId })
    void subscribeStream(dispatchId)
  }, [reportId, projectId, subscribeStream])

  const cancel = useCallback(() => {
    cancelled.current = true
    abortRef.current?.abort()
    setState({ status: 'idle' })
  }, [])

  return { state, dispatch, cancel }
}
