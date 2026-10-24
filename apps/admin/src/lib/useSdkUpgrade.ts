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
import { describeActionError } from './actionError'

export type SdkUpgradeStatus =
  | 'idle'
  | 'queueing'
  | 'queued'
  | 'running'
  /** Bump pushed; the host lockfile workflow runs, then the PR opens (ADR 0019). */
  | 'awaiting_lockfile'
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
  /** Last "Check CI status" / "Refresh all" failure, in plain English. Cleared on success. */
  syncError?: string
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
  /** Set once the upgrade PR merged (from the job row or a sync). */
  mergedAt?: string
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
/** awaiting_lockfile resolves on the 5-minute sdk-release-sync tick (30 min at most). */
const AWAITING_POLL_INTERVAL_MS = 30_000
const TERMINAL_TTL_MS = 2 * 60 * 60_000
/** Re-read an open upgrade PR's checks from GitHub at most this often. */
export const UPGRADE_CI_REFRESH_MS = 60_000

/** True when the last GitHub re-read is missing or older than a minute. */
export function upgradeCiRefreshDue(lastAt: number | null, now: number, minMs = UPGRADE_CI_REFRESH_MS): boolean {
  if (lastAt == null || !Number.isFinite(lastAt)) return true
  return now - lastAt >= minMs
}

/** An upgrade PR the Update center is still showing (open, or not yet synced). */
export function isOpenUpgradePr(state: {
  status?: string
  prUrl?: string
  prState?: string
  mergedAt?: string
}): boolean {
  return state.status === 'completed'
    && Boolean(state.prUrl)
    && state.prState !== 'merged'
    && state.prState !== 'closed'
    && !state.mergedAt
}

function ciRefreshKey(projectId: string, jobId: string) {
  return `mushi_sdk_upgrade_ci_at:${projectId}:${jobId}`
}

function readCiRefreshAt(projectId: string, jobId: string): number | null {
  if (typeof window === 'undefined') return null
  try {
    const n = Number(sessionStorage.getItem(ciRefreshKey(projectId, jobId)))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** Stamp a refresh and return that stamp, or null when one already ran this minute. */
function takeCiRefresh(projectId: string, jobId: string, now = Date.now()): number | null {
  if (!upgradeCiRefreshDue(readCiRefreshAt(projectId, jobId), now)) return null
  try {
    sessionStorage.setItem(ciRefreshKey(projectId, jobId), String(now))
  } catch { /* private mode still refreshes */ }
  return now
}

function releaseCiRefresh(projectId: string, jobId: string, token: number) {
  if (typeof window === 'undefined') return
  try {
    if (readCiRefreshAt(projectId, jobId) === token) sessionStorage.removeItem(ciRefreshKey(projectId, jobId))
  } catch { /* ignore */ }
}

function markCiRefresh(projectId: string, jobId: string, now = Date.now()) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(ciRefreshKey(projectId, jobId), String(now))
  } catch { /* ignore */ }
}

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
  const stateRef = useRef(state)
  const projectRef = useRef(projectId)
  stateRef.current = state
  projectRef.current = projectId

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
      if (d.status === 'awaiting_lockfile') {
        // Not stuck: the PR opens server-side. Poll slowly, without the 10-minute cap.
        setTimeout(() => poll(jobId, Date.now()), AWAITING_POLL_INTERVAL_MS)
        return
      }
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
            mergedAt: job.merged_at ?? undefined,
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
        plan: job.plan ?? undefined,
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
          // The envelope keeps `data` on an error but drops extra error
          // fields, so the running job's id arrives as `data.jobId` (QA bug 124).
          const runningJobId = alreadyInProgressJobId(res)
          if (runningJobId) {
            setState({ status: 'queued', jobId: runningJobId })
            void subscribeStream(runningJobId)
            return
          }
          setState({
            status: 'failed',
            error: describeActionError(res.error, 'Could not start the upgrade. Try again in a moment.'),
          })
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
            mergedAt: prior?.merged_at ?? undefined,
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

  const syncStatus = useCallback(async (jobId: string): Promise<boolean> => {
    const forProject = projectId
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
    }>(`/v1/admin/projects/${forProject}/sdk-upgrade/${jobId}/sync`, { method: 'POST' })
    if (projectRef.current !== forProject) return false
    if (!res.ok || !res.data) {
      // Used to return silently, so "Check CI status" / "Refresh all" looked
      // like nothing happened (QA bug 260).
      if (!cancelled.current) {
        const message = describeActionError(res.error, 'Could not check CI status on GitHub. Try again in a moment.')
        setState((s) => ({ ...s, syncError: message }))
      }
      return false
    }
    const d = res.data
    const fields: Partial<SdkUpgradeState> = {
      syncError: undefined,
      releaseStatus: d.releaseStatus,
      prState: d.prState,
      checkRunStatus: d.checkRunStatus ?? undefined,
      checkRunConclusion: d.checkRunConclusion ?? undefined,
      deployStatus: d.deployStatus ?? undefined,
      deployUrl: d.deployUrl ?? undefined,
      workflowUrl: d.workflowUrl ?? undefined,
    }
    markCiRefresh(forProject, jobId)
    const apply = (s: SdkUpgradeState): SdkUpgradeState => {
      // A newer job may have replaced this one while GitHub was answering.
      if (s.jobId !== jobId) return s
      const updated: SdkUpgradeState = { ...s, ...fields }
      // Persist cockpit fields so a reload restores the freshest sync result,
      // including when the operator left the page before this request landed.
      if (updated.jobId === jobId && (updated.status === 'completed' || updated.status === 'completed_no_pr')) {
        persistTerminal(forProject, updated)
      }
      return updated
    }
    if (cancelled.current) {
      apply(stateRef.current)
      return true
    }
    setState(apply)
    return true
  }, [projectId])

  // The stored check is up to 5 minutes old (sdk-release-sync) and a reload
  // used to paint that copy and stop. Re-read GitHub when an open PR is shown,
  // at most once a minute, so a green gate replaces a stale "CI failing".
  const { status: upgradeStatus, jobId: upgradeJobId, prUrl: upgradePrUrl, prState: upgradePrState, mergedAt: upgradeMergedAt } = state
  useEffect(() => {
    if (!isOpenUpgradePr({ status: upgradeStatus, prUrl: upgradePrUrl, prState: upgradePrState, mergedAt: upgradeMergedAt }) || !upgradeJobId) return
    const token = takeCiRefresh(projectId, upgradeJobId)
    if (token == null) return
    void syncStatus(upgradeJobId).then((ok) => {
      if (!ok) releaseCiRefresh(projectId, upgradeJobId, token)
    })
  }, [projectId, upgradeStatus, upgradeJobId, upgradePrUrl, upgradePrState, upgradeMergedAt, syncStatus])

  const mergePr = useCallback(async (jobId: string, method: 'squash' | 'merge' | 'rebase' = 'squash') => {
    setState((s) => ({ ...s, releaseStatus: 'merging' }))
    const res = await apiFetch<{ ok: boolean; sha?: string | null; alreadyMerged?: boolean }>(
      `/v1/admin/projects/${projectId}/sdk-upgrade/${jobId}/merge`,
      { method: 'POST', body: JSON.stringify({ method }) },
    )
    if (!res.ok) {
      setState((s) => ({
        ...s,
        releaseStatus: 'pr_opened',
        error: describeActionError(res.error, 'Could not merge the PR on GitHub. Open it on GitHub to see why.'),
      }))
      return
    }
    setState((s) => {
      const updated: SdkUpgradeState = {
        ...s,
        releaseStatus: 'merged',
        prState: 'merged',
        mergedAt: new Date().toISOString(),
        error: undefined,
      }
      persistTerminal(projectId, updated)
      return updated
    })
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

/**
 * The running job's id when POST /sdk-upgrade answered 409
 * ALREADY_IN_PROGRESS: read from `data.jobId` (what apiFetch keeps), falling
 * back to `error.jobId` for older servers.
 * @internal Exported for unit tests.
 */
export function alreadyInProgressJobId(res: {
  ok: boolean
  data?: unknown
  error?: { code?: string } & Record<string, unknown>
}): string | null {
  if (res.ok || res.error?.code !== 'ALREADY_IN_PROGRESS') return null
  const fromData = (res.data as { jobId?: unknown } | undefined)?.jobId
  if (typeof fromData === 'string' && fromData) return fromData
  const fromError = res.error?.jobId
  return typeof fromError === 'string' && fromError ? fromError : null
}
