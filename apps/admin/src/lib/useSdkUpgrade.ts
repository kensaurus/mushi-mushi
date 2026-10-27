/**
 * FILE: apps/admin/src/lib/useSdkUpgrade.ts
 * PURPOSE: React hook for the one-click "Create Upgrade PR" flow.
 *          Mirrors `useDispatchFix` in dispatchFix.ts — POST to enqueue,
 *          then SSE stream with polling fallback.
 *
 *          When the card opens on an upgrade PR that is still open, CI is
 *          re-read from GitHub at most once a minute, on the live head. The
 *          saved conclusion is the bump commit's until that refresh, so the
 *          card otherwise stays on "CI failing" after the PR head is green.
 *          A failed re-read keeps the last stored chips and says why.
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

/**
 * @internal Exported for tests only.
 * "Check CI status" failed: say why, and that the CI chips show the last
 * state Mushi stored (Mushi report 6449a621: a GitHub 403 used to wipe them
 * to "not checked yet").
 */
export function describeSyncFailure(error: { code?: string | null; message?: string | null } | null | undefined): string {
  const reason = describeActionError(error, 'the CI status could not be read').replace(/[.\s]+$/, '')
  return `Couldn't check: ${reason}; showing the last known state.`
}

export interface SdkUpgradeState {
  status: SdkUpgradeStatus
  jobId?: string
  prUrl?: string
  plan?: BumpEntry[]
  error?: string
  /** Last "Check CI status" / "Refresh all" failure, in plain English. Cleared on success. */
  syncError?: string
  /** True while "Check CI status" waits for GitHub. */
  syncing?: boolean
  /** When "Check CI status" last answered (ms), for "Checked just now". */
  checkedAt?: number
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

/** Page-open CI re-read. A minute matches the console's other GitHub refreshes. */
export const UPGRADE_CI_REFRESH_MS = 60_000

export interface UpgradeCiPayload {
  releaseStatus: string
  prState: string | null
  checkRunStatus: string | null
  checkRunConclusion: string | null
  deployStatus: string | null
  deployUrl: string | null
  workflowUrl: string | null
}

/** True when this open upgrade PR should re-read CI. Merged and closed PRs do not. */
export function openUpgradePrWantsCiRefresh(job: {
  status: string
  jobId?: string
  prUrl?: string | null
  prState?: string | null
  mergedAt?: string | null
}): boolean {
  if (job.status !== 'completed' || !job.jobId || !job.prUrl) return false
  if (job.mergedAt) return false
  if (job.prState === 'merged' || job.prState === 'closed') return false
  return true
}

/** True when the last successful page-open refresh is missing or older than the interval. */
export function upgradeCiRefreshDue(
  lastAtMs: number | null,
  nowMs: number,
  intervalMs = UPGRADE_CI_REFRESH_MS,
): boolean {
  if (lastAtMs == null || !Number.isFinite(lastAtMs)) return true
  return nowMs - lastAtMs >= intervalMs
}

export function upgradeCiRefreshDecision(
  job: Parameters<typeof openUpgradePrWantsCiRefresh>[0],
  lastAtMs: number | null,
  nowMs: number,
): 'refresh' | 'skip' {
  if (!openUpgradePrWantsCiRefresh(job)) return 'skip'
  return upgradeCiRefreshDue(lastAtMs, nowMs) ? 'refresh' : 'skip'
}

export function upgradeCiRefreshStorageKey(projectId: string, jobId: string): string {
  return `mushi_sdk_upgrade_ci_refresh:${projectId}:${jobId}`
}

export function readUpgradeCiRefreshAt(
  storage: Pick<Storage, 'getItem'>,
  projectId: string,
  jobId: string,
): number | null {
  try {
    const raw = storage.getItem(upgradeCiRefreshStorageKey(projectId, jobId))
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function markUpgradeCiRefresh(
  storage: Pick<Storage, 'setItem'>,
  projectId: string,
  jobId: string,
  nowMs: number,
): void {
  try {
    storage.setItem(upgradeCiRefreshStorageKey(projectId, jobId), String(nowMs))
  } catch { /* quota / private mode */ }
}

export function applyUpgradeCi(state: SdkUpgradeState, data: UpgradeCiPayload): SdkUpgradeState {
  return {
    ...state,
    syncError: undefined,
    releaseStatus: data.releaseStatus,
    prState: data.prState ?? undefined,
    checkRunStatus: data.checkRunStatus ?? undefined,
    checkRunConclusion: data.checkRunConclusion ?? undefined,
    deployStatus: data.deployStatus ?? undefined,
    deployUrl: data.deployUrl ?? undefined,
    workflowUrl: data.workflowUrl ?? undefined,
  }
}

/**
 * Fold a loaded job together with a CI sync that may already have finished.
 * The sync response can land before the saved snapshot is committed; without
 * this the snapshot's stale "failure" overwrites the green head.
 */
export function mergeLoadedUpgradeJob(
  current: SdkUpgradeState,
  next: SdkUpgradeState,
  syncedJobId: string | null,
  pending: { jobId: string; data: UpgradeCiPayload; checkedAt?: number } | null,
): SdkUpgradeState {
  if (next.jobId && current.jobId === next.jobId && syncedJobId === next.jobId) {
    return {
      ...next,
      syncError: current.syncError,
      syncing: false,
      checkedAt: current.checkedAt ?? pending?.checkedAt,
      releaseStatus: current.releaseStatus,
      prState: current.prState,
      checkRunStatus: current.checkRunStatus,
      checkRunConclusion: current.checkRunConclusion,
      deployStatus: current.deployStatus,
      deployUrl: current.deployUrl,
      workflowUrl: current.workflowUrl,
      mergedAt: current.mergedAt ?? next.mergedAt,
    }
  }
  if (pending && next.jobId && pending.jobId === next.jobId) {
    return {
      ...applyUpgradeCi(next, pending.data),
      syncing: false,
      ...(pending.checkedAt != null ? { checkedAt: pending.checkedAt } : {}),
    }
  }
  return next
}

export function useSdkUpgrade(projectId: string) {
  const [state, setState] = useState<SdkUpgradeState>({ status: 'idle' })
  const cancelled = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const reachedTerminal = useRef(false)
  const creatingRef = useRef(false)
  const mergeSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bumped when the project changes so an in-flight sync cannot paint the previous app. */
  const syncEpoch = useRef(0)
  const syncProjectId = useRef<string | null>(null)
  const ciSyncedJobId = useRef<string | null>(null)
  const pendingCi = useRef<{ jobId: string; data: UpgradeCiPayload; checkedAt?: number } | null>(null)

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

  const syncStatus = useCallback(async (jobId: string, epoch = syncEpoch.current) => {
    // No job in state yet: don't raise `syncing`. The success path used to
    // return that state unchanged, so the spinner stayed up until a later load.
    setState((s) => (s.jobId === jobId ? { ...s, syncing: true } : s))
    const res = await apiFetch<UpgradeCiPayload>(
      `/v1/admin/projects/${projectId}/sdk-upgrade/${jobId}/sync`,
      { method: 'POST' },
    )
    // A project switch bumps the epoch. Drop the previous app's conclusion.
    // A discarded request does not count toward the once-a-minute limit, so
    // the next open of the card still re-reads CI. A failed read does not
    // count either: `upgradeCiRefreshDue` tracks the last success.
    if (epoch !== syncEpoch.current || cancelled.current) return
    if (!res.ok || !res.data) {
      // Used to return silently, so "Check CI status" / "Refresh all" looked
      // like nothing happened (QA bug 260). The cockpit fields stay as they
      // were: the server stores nothing when GitHub fails to answer.
      const message = describeSyncFailure(res.error)
      setState((s) => (s.jobId && s.jobId !== jobId ? s : { ...s, syncing: false, syncError: message }))
      return
    }
    if (typeof window !== 'undefined') markUpgradeCiRefresh(window.sessionStorage, projectId, jobId, Date.now())
    const data = res.data
    const checkedAt = Date.now()
    ciSyncedJobId.current = jobId
    pendingCi.current = { jobId, data, checkedAt }
    setState((s) => {
      // The saved snapshot may not be committed yet. `mergeLoadedUpgradeJob`
      // applies `pendingCi` when it is.
      if (s.jobId && s.jobId !== jobId) return s
      if (!s.jobId) return { ...s, syncing: false }
      const updated = { ...applyUpgradeCi(s, data), syncing: false, checkedAt }
      if (updated.status === 'completed' || updated.status === 'completed_no_pr') {
        persistTerminal(projectId, updated)
      }
      return updated
    })
  }, [projectId])

  // Resume tracking if the operator reloads while a job is still queued/running.
  // An open upgrade PR re-reads CI here. The card used to paint the conclusion
  // saved at completion and never ask GitHub again, so it stayed "CI failing"
  // after the head's required check went green.
  useEffect(() => {
    if (!projectId) return
    if (syncProjectId.current !== projectId) {
      if (syncProjectId.current !== null) {
        syncEpoch.current += 1
        ciSyncedJobId.current = null
        pendingCi.current = null
      }
      syncProjectId.current = projectId
    }
    const epoch = syncEpoch.current
    cancelled.current = false
    reachedTerminal.current = false
    let disposed = false

    const refreshOpenPrCi = (job: {
      status: string
      jobId?: string
      prUrl?: string | null
      prState?: string | null
      mergedAt?: string | null
    }) => {
      if (disposed || !job.jobId || typeof window === 'undefined') return
      const now = Date.now()
      const lastAt = readUpgradeCiRefreshAt(window.sessionStorage, projectId, job.jobId)
      if (upgradeCiRefreshDecision(job, lastAt, now) !== 'refresh') return
      void syncStatus(job.jobId, epoch)
    }

    const showJob = (next: SdkUpgradeState, persist: boolean) => {
      const pending = pendingCi.current
      const upgraded = pending?.jobId === next.jobId
      if (persist || upgraded) {
        // Keep the freshest sync, including when it finished before this
        // snapshot was committed, so a reload does not restore the bump commit.
        const stored = upgraded && pending
          ? {
              ...applyUpgradeCi(next, pending.data),
              syncing: false as const,
              ...(pending.checkedAt != null ? { checkedAt: pending.checkedAt } : {}),
            }
          : next
        persistTerminal(projectId, stored)
      }
      setState((current) => mergeLoadedUpgradeJob(current, next, ciSyncedJobId.current, pendingCi.current))
    }

    ;(async () => {
      const persisted = readPersistedTerminal(projectId)
      if (persisted) {
        reachedTerminal.current = true
        showJob(persisted, false)
        refreshOpenPrCi(persisted)
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
          if (disposed) return
          showJob(next, true)
          refreshOpenPrCi(next)
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
  }, [projectId, subscribeStream, syncStatus])

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
