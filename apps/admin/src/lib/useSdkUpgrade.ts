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
  /** True when POST returned an existing open upgrade PR instead of enqueueing. */
  reused?: boolean
  // Release cockpit fields — populated after PR is opened via syncStatus / mergePr
  releaseStatus?: string
  prState?: string
  checkRunStatus?: string
  checkRunConclusion?: string
  deployStatus?: string
  deployUrl?: string
  workflowUrl?: string
}

interface JobRow {
  id: string
  status: string
  pr_url?: string | null
  plan?: BumpEntry[] | null
  error?: string | null
  pr_state?: string | null
  release_status?: string | null
  check_run_status?: string | null
  check_run_conclusion?: string | null
  deploy_status?: string | null
  deploy_url?: string | null
  merged_at?: string | null
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
  const creatingRef = useRef(false)
  const mergeSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      cancelled.current = true
      abortRef.current?.abort()
      if (mergeSyncTimer.current) clearTimeout(mergeSyncTimer.current)
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
      // Re-check after the await: the row may have unmounted mid-request, in
      // which case we must not setState or schedule another poll.
      if (cancelled.current) return
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
          const next: SdkUpgradeState = {
            status: 'completed',
            jobId: job.id,
            prUrl: job.pr_url,
            plan: job.plan ?? undefined,
            releaseStatus: job.release_status ?? undefined,
            prState: job.pr_state ?? undefined,
            checkRunStatus: job.check_run_status ?? undefined,
            checkRunConclusion: job.check_run_conclusion ?? undefined,
            deployStatus: job.deploy_status ?? undefined,
            deployUrl: job.deploy_url ?? undefined,
          }
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
      setState({
        status: job.status as SdkUpgradeStatus,
        jobId: job.id,
        releaseStatus: job.release_status ?? undefined,
        prState: job.pr_state ?? undefined,
        checkRunStatus: job.check_run_status ?? undefined,
        checkRunConclusion: job.check_run_conclusion ?? undefined,
        deployStatus: job.deploy_status ?? undefined,
        deployUrl: job.deploy_url ?? undefined,
      })
      void subscribeStream(job.id)
    })()

    return () => {
      disposed = true
    }
  }, [projectId, subscribeStream])

  const enqueueUpgrade = useCallback(
    async (options?: { refresh?: boolean }) => {
      if (creatingRef.current) return
      creatingRef.current = true
      cancelled.current = false
      reachedTerminal.current = false
      if (!options?.refresh) {
        clearPersistedTerminal(projectId)
      }
      setState({ status: 'queueing' })
      try {
        const res = await apiFetch<{
          jobId?: string
          status?: string
          createdAt?: string
          reused?: boolean
          prUrl?: string
          prNumber?: number
          branch?: string
          message?: string
          priorJob?: JobRow | null
        }>(
          `/v1/admin/projects/${projectId}/sdk-upgrade`,
          {
            method: 'POST',
            body: JSON.stringify({ refresh: options?.refresh === true }),
          },
        )
        if (!res.ok || !res.data) {
          const err = (res as { error?: { code?: string; message?: string; jobId?: string } }).error
          const errCode = err?.code ?? 'UPGRADE_FAILED'
          const errMsg = err?.message ?? 'Could not start upgrade'
          if (errCode === 'ALREADY_IN_PROGRESS' && err?.jobId) {
            setState({ status: 'queued', jobId: err.jobId })
            void subscribeStream(err.jobId)
            return
          }
          setState({ status: 'failed', error: `${errCode}: ${errMsg}` })
          return
        }

        const data = res.data
        if (data.reused && data.prUrl) {
          reachedTerminal.current = true
          const prior = data.priorJob
          const next: SdkUpgradeState = {
            status: 'completed',
            jobId: data.jobId ?? prior?.id ?? undefined,
            prUrl: data.prUrl,
            plan: prior?.plan ?? undefined,
            reused: true,
            releaseStatus: prior?.release_status ?? undefined,
            prState: prior?.pr_state ?? undefined,
            checkRunStatus: prior?.check_run_status ?? undefined,
            checkRunConclusion: prior?.check_run_conclusion ?? undefined,
            deployStatus: prior?.deploy_status ?? undefined,
            deployUrl: prior?.deploy_url ?? undefined,
            error: data.message,
          }
          persistTerminal(projectId, next)
          setState(next)
          return
        }

        if (!data.jobId) {
          setState({ status: 'failed', error: 'Upgrade enqueue returned no job id' })
          return
        }

        const { jobId } = data
        setState({ status: 'queued', jobId })
        void subscribeStream(jobId)
      } finally {
        creatingRef.current = false
      }
    },
    [projectId, subscribeStream],
  )

  const createUpgradePr = useCallback(async () => {
    await enqueueUpgrade()
  }, [enqueueUpgrade])

  const refreshUpgradePr = useCallback(async () => {
    await enqueueUpgrade({ refresh: true })
  }, [enqueueUpgrade])

  const syncStatus = useCallback(async (jobId: string) => {
    const res = await apiFetch<{
      releaseStatus: string
      prState: string
      checkRunStatus: string | null
      checkRunConclusion: string | null
      workflowStatus: string | null
      workflowConclusion: string | null
      workflowUrl: string | null
      deployStatus: string | null
      deployUrl: string | null
      deployEnvironment: string | null
    }>(`/v1/admin/projects/${projectId}/sdk-upgrade/${jobId}/sync`, { method: 'POST' })
    if (!res.ok || !res.data) return
    const d = res.data
    setState((s) => {
      const updated: SdkUpgradeState = {
        ...s,
        releaseStatus: d.releaseStatus,
        prState: d.prState,
        checkRunStatus: d.checkRunStatus ?? undefined,
        checkRunConclusion: d.checkRunConclusion ?? undefined,
        deployStatus: d.deployStatus ?? undefined,
        deployUrl: d.deployUrl ?? undefined,
        workflowUrl: d.workflowUrl ?? undefined,
      }
      // Persist cockpit fields so a hot-reload restores the freshest sync result
      if (updated.status === 'completed' || updated.status === 'completed_no_pr') {
        persistTerminal(projectId, updated)
      }
      return updated
    })
  }, [projectId])

  const mergePr = useCallback(async (jobId: string, method: 'squash' | 'merge' | 'rebase' = 'squash') => {
    setState((s) => ({ ...s, releaseStatus: 'merging' }))
    const res = await apiFetch<{ ok: boolean; sha?: string | null; alreadyMerged?: boolean }>(
      `/v1/admin/projects/${projectId}/sdk-upgrade/${jobId}/merge`,
      { method: 'POST', body: JSON.stringify({ method }) },
    )
    if (!res.ok) {
      const err = (res as { error?: { message?: string } }).error
      setState((s) => ({ ...s, releaseStatus: 'pr_opened', error: err?.message ?? 'Merge failed' }))
      return
    }
    setState((s) => ({ ...s, releaseStatus: 'merged', prState: 'merged' }))
    // Auto-sync after merge to pick up CI / deploy status. Tracked + guarded so
    // an unmount inside the 5s window doesn't fire a setState on a dead component.
    if (mergeSyncTimer.current) clearTimeout(mergeSyncTimer.current)
    mergeSyncTimer.current = setTimeout(() => {
      if (!cancelled.current) void syncStatus(jobId)
    }, 5000)
  }, [projectId, syncStatus])

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

  return { state, createUpgradePr, refreshUpgradePr, cancel, reset, mergePr, syncStatus }
}
