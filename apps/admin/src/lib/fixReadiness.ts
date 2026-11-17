/**
 * FILE: apps/admin/src/lib/fixReadiness.ts
 * PURPOSE: What happens to a filed setup task, said truthfully from the app's
 *          Autofix and GitHub state (the dispatch preflight).
 *
 *          Owner, 2026-11-17: after "File install task", Home said "Task
 *          filed: your fix agent picks it up and opens the PR" while Autofix
 *          was off for that app and the task read "No fix dispatched yet".
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './supabase'
import type { PreflightCheck } from './useDispatchPreflight'

export type FixReadiness =
  /** Every step is ready: Mushi Mushi starts the fix and opens a draft PR. */
  | { kind: 'ready' }
  /** Autofix is off. `githubReady` says whether it can be turned on here. */
  | { kind: 'autofix_off'; githubReady: boolean; githubHref: string }
  /** Autofix is on, but another step blocks the fix (GitHub, code, the agent). */
  | { kind: 'blocked'; label: string; href: string }
  /** Not read yet, or could not be read. */
  | { kind: 'unknown' }

/** @internal Exported for unit tests only. */
export function fixReadinessFromChecks(checks: readonly PreflightCheck[] | null): FixReadiness {
  if (!checks || checks.length === 0) return { kind: 'unknown' }
  const github = checks.find((c) => c.key === 'github')
  const autofix = checks.find((c) => c.key === 'autofix')
  if (autofix && !autofix.ready) {
    return { kind: 'autofix_off', githubReady: github?.ready ?? false, githubHref: github?.fixHref ?? '/integrations/config#platform-card-github' }
  }
  const blocking = checks.find((c) => !c.ready)
  if (blocking) return { kind: 'blocked', label: blocking.label, href: blocking.fixHref }
  return { kind: 'ready' }
}

/** Reads the preflight once `enabled` (a task was filed), and again on `reload`. */
export function useFixReadiness(projectId: string, enabled: boolean): { readiness: FixReadiness; reload: () => void } {
  const [checks, setChecks] = useState<PreflightCheck[] | null>(null)
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void Promise.resolve(apiFetch<{ checks: PreflightCheck[] }>(`/v1/admin/projects/${projectId}/preflight`, { cache: 'no-store' }))
      .then((res) => {
        if (live) setChecks(res?.ok && res.data ? res.data.checks : null)
      })
      .catch(() => {
        if (live) setChecks(null)
      })
    return () => {
      live = false
    }
  }, [projectId, enabled, epoch])
  const reload = useCallback(() => setEpoch((n) => n + 1), [])
  return { readiness: fixReadinessFromChecks(checks), reload }
}
