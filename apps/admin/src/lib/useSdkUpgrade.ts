/**
 * FILE: apps/admin/src/lib/useSdkUpgrade.ts
 * PURPOSE: React hook for the one-click "Create Upgrade PR" flow.
 *          Mirrors `useDispatchFix` in dispatchFix.ts — POST to enqueue,
 *          then SSE stream with polling fallback.
 *
 * Usage:
 *   const { state, createUpgradePr, cancel } = useSdkUpgrade(projectId)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, supabase } from './supabase'
import { RESOLVED_API_URL } from './env'
import { openSseStream, type SseEvent } from './sseClient'

export type SdkUpgradeStatus =
  | 'idle'
  | 'queueing'
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_no_pr'
  | 'failed'
  | 'cancelled'

export interface BumpEntry {
  package: string
  from: string
  to: string
  migrateToWeb?: boolean
}

export interface SdkUpgradeState {
  status: SdkUpgradeStatus
  jobId?: string
  prUrl?: string
  plan?: BumpEntry[]
  error?: string
}

interface JobRow {
  id: string
  status: string
  pr_url?: string | null
  plan?: BumpEntry[] | null
  error?: string | null
}

interface SsePayload {
  status: string
  prUrl?: string | null
  plan?: BumpEntry[] | null
  error?: string | null
}

const POLL_INTERVAL_MS = 2_500
const POLL_MAX_MS = 10 * 60_000
const TERMINAL_TTL_MS = 2 * 60 * 60_000

function terminalStorageKey(projectId: string) {
  return `mushi_sdk_upgrade_terminal:${projectId}`
}

function readPersistedTerminal(projectId: string): SdkUpgradeState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(terminalStorageKey(projectId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as SdkUpgradeState & { savedAt?: number }
    if (!parsed.savedAt || Date.now() - parsed.savedAt > TERMINAL_TTL_MS) {
      sessionStorage.removeItem(terminalStorageKey(projectId))
      return null
    }
    const { savedAt: _savedAt, ...state } = parsed
    if (!['completed', 'completed_no_pr', 'failed', 'cancelled'].includes(state.status)) return null
    return state
  } catch {
    return null
  }
}

function persistTerminal(projectId: string, state: SdkUpgradeState) {
  if (typeof window === 'undefined') return
  if (!['completed', 'completed_no_pr', 'failed', 'cancelled'].includes(state.status)) return
  try {
    sessionStorage.setItem(
      terminalStorageKey(projectId),
      JSON.stringify({ ...state, savedAt: Date.now() }),
    )
  } catch { /* quota / private mode */ }
}

function clearPersistedTerminal(projectId: string) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(terminalStorageKey(projectId))
  } catch { /* ignore */ }
}

export function useSdkUpgrade(projectId: string) {
  const [state, setState] = useState<SdkUpgradeState>({ status: 'idle' })
  const cancelled = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const reachedTerminal = useRef(false)

  useEffect(
    () => () => {
      cancelled.current = true
      abortRef.current?.abort()
    },
    [],
  )

  const poll = useCallback(
    async (jobId: string, startedAt: number) => {
      if (cancelled.current) return
      if (Date.now() - startedAt > POLL_MAX_MS) {
        setState((s) => ({ ...s, status: 'failed', error: 'Upgrade timed out (>10 min)' }))
        return
      }
      const res = await apiFetch<JobRow>(`/v1/admin/projects/${projectId}/sdk-upgrade/${jobId}`)
      if (!res.ok || !res.data) {
        setState((s) => ({ ...s, status: 'failed', error: 'Failed to fetch upgrade status' }))
        return
      }
      const d = res.data
      if (d.status === 'completed') {
        reachedTerminal.current = true
        const next = { status: 'completed' as const, jobId, prUrl: d.pr_url ?? undefined, plan: d.plan ?? undefined }
        persistTerminal(projectId, next)
        setState(next)
        return
      }
      if (d.status === 'completed_no_pr') {
        reachedTerminal.current = true
        const next = { status: 'completed_no_pr' as const, jobId, error: d.error ?? 'All packages already up to date.' }
        persistTerminal(projectId, next)
        setState(next)
        return
      }
      if (d.status === 'failed' || d.status === 'cancelled') {
        reachedTerminal.current = true
        const next = { status: 'failed' as const, jobId, error: d.error ?? `Job ${d.status}` }
        persistTerminal(projectId, next)
        setState(next)
        return
      }
      setState((s) => ({ ...s, status: d.status as SdkUpgradeStatus, jobId }))
      setTimeout(() => poll(jobId, startedAt), POLL_INTERVAL_MS)
    },
    [projectId],
  )

  const subscribeStream = useCallback(
    async (jobId: string) => {
      if (cancelled.current) return
      const { data: session } = await supabase.auth.getSession()
      const bearer = session.session?.access_token
      if (!bearer) {
        poll(jobId, Date.now())
        return
      }
      const ctrl = new AbortController()
      abortRef.current = ctrl
      let pollStarted = false
      const startPolling = () => {
        if (pollStarted || cancelled.current || reachedTerminal.current) return
        pollStarted = true
        poll(jobId, Date.now())
      }
      try {
        await openSseStream({
          url: `${RESOLVED_API_URL}/v1/admin/projects/${projectId}/sdk-upgrade/${jobId}/stream`,
          bearer,
          signal: ctrl.signal,
          onEvent: (raw: SseEvent) => {
            if (cancelled.current) return
            if (raw.event === 'status') {
              try {
                const p = JSON.parse(raw.data) as SsePayload
                if (p.status === 'completed') {
                  reachedTerminal.current = true
                  const next = { status: 'completed' as const, jobId, prUrl: p.prUrl ?? undefined, plan: p.plan ?? undefined }
                  persistTerminal(projectId, next)
                  setState(next)
                } else if (p.status === 'completed_no_pr') {
                  reachedTerminal.current = true
                  const next = { status: 'completed_no_pr' as const, jobId, error: p.error ?? 'All packages up to date.' }
                  persistTerminal(projectId, next)
                  setState(next)
                } else if (p.status === 'failed' || p.status === 'cancelled') {
                  reachedTerminal.current = true
                  const next = { status: 'failed' as const, jobId, error: p.error ?? `Job ${p.status}` }
                  persistTerminal(projectId, next)
                  setState(next)
                } else {
                  setState((s) => ({ ...s, status: p.status as SdkUpgradeStatus, jobId }))
                }
              } catch { /* malformed — ignore */ }
            }
          },
          onClose: (reason, err) => {
            if (cancelled.current || reachedTerminal.current) return
            if (reason === 'abort') return
            const detail = reason === 'error'
              ? (err instanceof Error ? err.message : String(err))
              : 'stream closed before terminal event'
            console.warn(`SDK upgrade SSE closed (${reason}): ${detail} — falling back to polling`)
            startPolling()
          },
        })
      } catch {
        startPolling()
      }
    },
    [projectId, poll],
  )

  // Resume tracking if the operator reloads while a job is still queued/running.
  useEffect(() => {
    if (!projectId) return
    cancelled.current = false
    reachedTerminal.current = false
    let disposed = false

    ;(async () => {
      const persisted = readPersistedTerminal(projectId)
      if (persisted) {
        reachedTerminal.current = true
        setState(persisted)
        return
      }

      const res = await apiFetch<JobRow | null>(
        `/v1/admin/projects/${projectId}/sdk-upgrade/in-flight`,
      )
      if (disposed || !res.ok || !res.data) return
      const job = res.data
      if (!job?.id) return
      if (['completed', 'completed_no_pr', 'failed', 'cancelled'].includes(job.status)) {
        if (job.status === 'completed' && job.pr_url) {
          const next = { status: 'completed' as const, jobId: job.id, prUrl: job.pr_url, plan: job.plan ?? undefined }
          persistTerminal(projectId, next)
          setState(next)
        } else if (job.status === 'completed_no_pr') {
          const next = { status: 'completed_no_pr' as const, jobId: job.id, error: job.error ?? 'All packages up to date.' }
          persistTerminal(projectId, next)
          setState(next)
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          const next = { status: 'failed' as const, jobId: job.id, error: job.error ?? `Job ${job.status}` }
          persistTerminal(projectId, next)
          setState(next)
        }
        return
      }
      setState({ status: job.status as SdkUpgradeStatus, jobId: job.id })
      void subscribeStream(job.id)
    })()

    return () => {
      disposed = true
    }
  }, [projectId, subscribeStream])

  const createUpgradePr = useCallback(async () => {
    cancelled.current = false
    reachedTerminal.current = false
    clearPersistedTerminal(projectId)
    setState({ status: 'queueing' })
    const res = await apiFetch<{ jobId: string; status: string; createdAt: string }>(
      `/v1/admin/projects/${projectId}/sdk-upgrade`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    if (!res.ok || !res.data) {
      const err = (res as { error?: { code?: string; message?: string; jobId?: string } }).error
      const errCode = err?.code ?? 'UPGRADE_FAILED'
      const errMsg = err?.message ?? 'Could not start upgrade'
      // Resume tracking when the server reports an in-flight job (409 dedupe).
      if (errCode === 'ALREADY_IN_PROGRESS' && err?.jobId) {
        setState({ status: 'queued', jobId: err.jobId })
        void subscribeStream(err.jobId)
        return
      }
      setState({ status: 'failed', error: `${errCode}: ${errMsg}` })
      return
    }
    const { jobId } = res.data
    setState({ status: 'queued', jobId })
    void subscribeStream(jobId)
  }, [projectId, subscribeStream])

  const cancel = useCallback(() => {
    cancelled.current = true
    abortRef.current?.abort()
    setState({ status: 'idle' })
  }, [])

  const reset = useCallback(() => {
    cancelled.current = false
    reachedTerminal.current = false
    clearPersistedTerminal(projectId)
    setState({ status: 'idle' })
  }, [projectId])

  return { state, createUpgradePr, cancel, reset }
}
