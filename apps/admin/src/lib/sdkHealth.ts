/**
 * FILE: apps/admin/src/lib/sdkHealth.ts
 * PURPOSE: SDK health in the console: the problems GET /sdk-health returns and
 *          a hook that runs each one's fix (write CI secrets, open an upgrade
 *          PR, file an install or CSP task), one at a time or all in order.
 *
 * The fixes reuse the existing flows: useCiSecretSync (sync-ci-secrets) and
 * useSdkUpgrade (sdk-upgrade). Tasks are POST /sdk-health/tasks.
 */

import { useCallback, useRef, useState } from 'react'
import { apiFetchMutate } from './supabase'
import { useCiSecretSync } from './useCiSecretSync'
import { useSdkUpgrade } from './useSdkUpgrade'

export type SdkHealthFixKind = 'install_task' | 'sync_ci_secrets' | 'upgrade_pr' | 'csp_task'

export interface SdkHealthProblem {
  id: 'not_installed' | 'no_repo' | 'no_sdk_key' | 'ci_secrets_missing' | 'never_seen' | 'outdated' | 'csp_blocks_api' | 'stale'
  severity: 'error' | 'warn' | 'info'
  title: string
  detail: string
  fix: { kind: SdkHealthFixKind; label: string } | null
  /** What already exists for it (an open upgrade PR), shown instead of a second fix. */
  link?: { label: string; href: string }
}

interface SdkHealthNote {
  check: 'repo' | 'ci_secrets' | 'site_csp' | 'versions'
  detail: string
}

export interface SdkHealthPayload {
  problems: SdkHealthProblem[]
  notes: SdkHealthNote[]
  installed: boolean | null
  lastSeenAt: string | null
  repoUrl: string | null
  siteUrl: string | null
  checkedAt: string
}

/** The Connect page anchor the panel sits under. */
export const SDK_HEALTH_ANCHOR = 'connect-sdk-health'

export function sdkHealthHref(projectId: string): string {
  return `/connect?project=${encodeURIComponent(projectId)}#${SDK_HEALTH_ANCHOR}`
}

/**
 * Fix all runs keys first (an install needs them in CI), then the install
 * task, then the upgrade PR, then the CSP task. Each kind runs once even when
 * two problems share it.
 */
const FIX_ORDER: readonly SdkHealthFixKind[] = ['sync_ci_secrets', 'install_task', 'upgrade_pr', 'csp_task']

export function fixAllPlan(problems: readonly SdkHealthProblem[]): SdkHealthFixKind[] {
  const kinds = new Set(problems.flatMap((p) => (p.fix ? [p.fix.kind] : [])))
  return FIX_ORDER.filter((k) => kinds.has(k))
}

/** What Fix all will do, for the confirm dialog. */
export const FIX_ACTION_TEXT: Record<SdkHealthFixKind, string> = {
  sync_ci_secrets:
    'Create a new SDK key and write it, with the project id and endpoint, to GitHub Actions. Older CI keys are revoked once GitHub accepts the new one. Apps already in the store keep the old key until their next build, so they stop sending bug reports until you ship one.',
  install_task: 'File a task for your fix agent to add the SDK to the app.',
  upgrade_pr: 'Open a PR that bumps the @mushi-mushi packages.',
  csp_task: "File a task for your fix agent to allow the Mushi API in the site's security policy.",
}

export interface TaskState {
  status: 'idle' | 'running' | 'filed' | 'failed'
  reportId?: string
  existing?: boolean
  error?: string
}

type TaskKind = 'install' | 'csp'
const TASK_KIND: Partial<Record<SdkHealthFixKind, TaskKind>> = { install_task: 'install', csp_task: 'csp' }

/**
 * `onSettled` runs after each fix (after the last one for Fix all), so the
 * panel can re-read SDK health and drop what is fixed. One fix at a time: a
 * second click while one runs does nothing (the server dedupe is the second
 * guard).
 */
export function useSdkHealthFixes(projectId: string, onSettled?: () => void) {
  const ci = useCiSecretSync(projectId)
  const upgrade = useSdkUpgrade(projectId)
  const [tasks, setTasks] = useState<Record<TaskKind, TaskState>>({ install: { status: 'idle' }, csp: { status: 'idle' } })
  const [runningAll, setRunningAll] = useState(false)
  const [running, setRunning] = useState<SdkHealthFixKind | null>(null)
  /** Fixes run from this panel; only their results are shown (not a job resumed from an earlier visit). */
  const [ran, setRan] = useState<SdkHealthFixKind[]>([])
  const busy = useRef(false)

  const fileTask = useCallback(
    async (kind: TaskKind) => {
      setTasks((t) => ({ ...t, [kind]: { status: 'running' } }))
      const res = await apiFetchMutate<{ reportId: string; existing: boolean }>(
        `/v1/admin/projects/${projectId}/sdk-health/tasks`,
        { method: 'POST', body: JSON.stringify({ kind }) },
      )
      setTasks((t) => ({
        ...t,
        [kind]: res.ok && res.data
          ? { status: 'filed', reportId: res.data.reportId, existing: res.data.existing }
          : { status: 'failed', error: res.error?.message ?? 'The task was not filed. Try again.' },
      }))
    },
    [projectId],
  )

  const runOne = useCallback(
    async (kind: SdkHealthFixKind) => {
      setRunning(kind)
      setRan((r) => (r.includes(kind) ? r : [...r, kind]))
      try {
        const task = TASK_KIND[kind]
        if (task) await fileTask(task)
        else if (kind === 'sync_ci_secrets') await ci.sync()
        else await upgrade.createUpgradePr()
      } finally {
        setRunning(null)
      }
    },
    [ci, upgrade, fileTask],
  )

  const runFix = useCallback(
    async (kind: SdkHealthFixKind) => {
      if (busy.current) return
      busy.current = true
      try {
        await runOne(kind)
      } finally {
        busy.current = false
        onSettled?.()
      }
    },
    [runOne, onSettled],
  )

  const runAll = useCallback(
    async (problems: readonly SdkHealthProblem[]) => {
      if (busy.current) return
      busy.current = true
      setRunningAll(true)
      try {
        // One after another: each result shows as it lands, and a failed
        // step does not stop the rest (they do not depend on each other).
        for (const kind of fixAllPlan(problems)) await runOne(kind)
      } finally {
        busy.current = false
        setRunningAll(false)
        onSettled?.()
      }
    },
    [runOne, onSettled],
  )

  return { ci: ci.state, upgrade: upgrade.state, tasks, runFix, runAll, runningAll, running, ran }
}

export type SdkHealthFixes = ReturnType<typeof useSdkHealthFixes>

/** Whether a fix is still running. */
export function fixBusy(fixes: Pick<SdkHealthFixes, 'ci' | 'upgrade' | 'tasks'>, kind: SdkHealthFixKind): boolean {
  if (kind === 'sync_ci_secrets') return fixes.ci.status === 'syncing'
  if (kind === 'upgrade_pr') return ['queueing', 'queued', 'running', 'awaiting_lockfile'].includes(fixes.upgrade.status)
  const task = TASK_KIND[kind]
  return task ? fixes.tasks[task].status === 'running' : false
}

/** Whether a fix ran from this panel and has a result to show instead of its button. */
export function fixStarted(fixes: Pick<SdkHealthFixes, 'ci' | 'upgrade' | 'tasks' | 'ran'>, kind: SdkHealthFixKind): boolean {
  if (!fixes.ran.includes(kind)) return false
  if (kind === 'sync_ci_secrets') return fixes.ci.status !== 'idle'
  if (kind === 'upgrade_pr') return fixes.upgrade.status !== 'idle'
  const task = TASK_KIND[kind]
  return task ? fixes.tasks[task].status !== 'idle' : false
}

export function taskStateFor(fixes: Pick<SdkHealthFixes, 'tasks'>, kind: SdkHealthFixKind): TaskState | null {
  const task = TASK_KIND[kind]
  return task ? fixes.tasks[task] : null
}
