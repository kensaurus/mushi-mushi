/**
 * FILE: _shared/report-deploy-live.ts
 * PURPOSE: "Fixed — not live yet (prod is on <sha>)" vs "Fixed and live" on a
 *          report whose fix PR merged (completeness gap #10, Plan 019 Phase 2).
 *
 * The report's merged fix is joined to the project's deploy truth:
 *   - the latest finished `deploy_drift` gate run (recipe-collector writes it
 *     with `commit_sha` = the default-branch head it compared against),
 *   - its open `not_deployed` findings (a target is behind that head for
 *     longer than the target's allowed lag), and
 *   - the newest `deploy_observations` row per target (what each deploy
 *     target actually runs).
 *
 * A fix merge stores no merge-commit SHA, so the join is by time: a drift run
 * that started after the merge compared against a head that contains the fix.
 *
 *   live      that run found no `not_deployed`, and every observed target
 *             runs that head commit
 *   not_live  that run has an open `not_deployed` finding; `prod_commit` is
 *             the commit a behind target still runs
 *   unknown   not checked since the merge, a target that is behind but still
 *             inside its allowed lag, or a read that failed
 *   null      the report does not read as fixed, no fix merged, or no deploy
 *             target was ever observed (deploy targets are optional recipe
 *             context, ADR 0016: no chip rather than a permanent "unknown")
 *
 * Never fails open: a failed read is `unknown`, never `live`.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sameCommit } from './recipe-drift.ts'

export type DeployLiveState = 'live' | 'not_live' | 'unknown'

export interface ReportDeployLive {
  state: DeployLiveState
  /** When the report's fix PR merged (the newest merged attempt). */
  merged_at: string
  /** The commit production runs, when a deploy observation names one. */
  prod_commit: string | null
  /** The deploy target `prod_commit` was read from. */
  target_id: string | null
  /** When that observation (or the drift run) was taken. */
  checked_at: string | null
  /** One plain sentence for the tooltip. */
  reason: string
}

export interface DeployDriftRunRow {
  id: string
  status: string
  started_at: string
  completed_at: string | null
  commit_sha: string | null
}

export interface DeployObservationRow {
  target_id: string
  ok: boolean
  observed_commit: string | null
  observed_at: string
}

function newestMerge(fixes: ReadonlyArray<{ merged_at?: string | null }>): string | null {
  let best: string | null = null
  let bestT = -Infinity
  for (const f of fixes) {
    const t = f.merged_at ? Date.parse(f.merged_at) : NaN
    if (!Number.isNaN(t) && t > bestT) {
      bestT = t
      best = f.merged_at as string
    }
  }
  return best
}

/** Newest observation per target (input may be in any order). */
function latestPerTarget(observations: readonly DeployObservationRow[]): DeployObservationRow[] {
  const byTarget = new Map<string, DeployObservationRow>()
  for (const o of observations) {
    const prev = byTarget.get(o.target_id)
    if (!prev || Date.parse(o.observed_at) > Date.parse(prev.observed_at)) byTarget.set(o.target_id, o)
  }
  return [...byTarget.values()].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
}

/**
 * Statuses where the report reads as fixed (report-status.ts canonical
 * `fixed` / `resolved` / `verified`, plus legacy `completed`, which the
 * reports list still files under Fixed). A reopened or re-dispatched report
 * gets no deploy chip, so the header never says "Fixed and live" beside
 * "Fixing".
 */
const FIXED_STATUSES = new Set(['fixed', 'resolved', 'verified', 'completed'])

export function reportReadsFixed(status: string | null | undefined): boolean {
  return typeof status === 'string' && FIXED_STATUSES.has(status)
}

/** Pure: the deploy state of a merged fix; `null` when no deploy target was ever observed. */
export function deriveDeployLive(input: {
  mergedAt: string
  run: DeployDriftRunRow | null
  openNotDeployed: number
  observations: readonly DeployObservationRow[]
}): ReportDeployLive | null {
  const { mergedAt, run, openNotDeployed } = input
  const latest = latestPerTarget(input.observations)
  const okWithCommit = latest.filter((o) => o.ok && typeof o.observed_commit === 'string' && o.observed_commit.length > 0)
  const newest = okWithCommit[0] ?? null
  const base = {
    merged_at: mergedAt,
    prod_commit: newest?.observed_commit ?? null,
    target_id: newest?.target_id ?? null,
    checked_at: newest?.observed_at ?? null,
  }

  // No deploy target has ever been observed (none declared, or only the store
  // connectors feed deploy_drift): nothing to say about the commit.
  if (latest.length === 0) return null
  const mergedT = Date.parse(mergedAt)
  if (!run || run.status === 'error' || Date.parse(run.started_at) < mergedT) {
    return { state: 'unknown', ...base, reason: 'Deploys have not been checked since this fix merged.' }
  }

  const head = run.commit_sha
  const behind = head ? okWithCommit.filter((o) => !sameCommit(o.observed_commit as string, head)) : []

  if (openNotDeployed > 0) {
    const stale = behind[0] ?? newest
    return {
      state: 'not_live',
      merged_at: mergedAt,
      prod_commit: stale?.observed_commit ?? null,
      target_id: stale?.target_id ?? null,
      checked_at: stale?.observed_at ?? run.completed_at ?? run.started_at,
      reason: stale
        ? `${stale.target_id} still runs an older commit than the default branch, which has the fix.`
        : 'A deploy target is behind the default branch, which has the fix.',
    }
  }

  if (head && okWithCommit.length > 0 && behind.length === 0) {
    return {
      state: 'live',
      merged_at: mergedAt,
      prod_commit: newest?.observed_commit ?? head,
      target_id: newest?.target_id ?? null,
      checked_at: newest?.observed_at ?? run.completed_at ?? run.started_at,
      reason: 'Every deploy target runs the default-branch commit that has the fix.',
    }
  }

  if (behind.length > 0) {
    const stale = behind[0]
    return {
      state: 'unknown',
      merged_at: mergedAt,
      prod_commit: stale.observed_commit,
      target_id: stale.target_id,
      checked_at: stale.observed_at,
      reason: `${stale.target_id} is still catching up with the default branch (inside its allowed deploy lag).`,
    }
  }
  return {
    state: 'unknown',
    ...base,
    reason: head ? 'No deploy target reported a commit after this fix merged.' : 'The last deploy check could not read the default-branch head.',
  }
}

const READ_FAILED = (mergedAt: string): ReportDeployLive => ({
  state: 'unknown',
  merged_at: mergedAt,
  prod_commit: null,
  target_id: null,
  checked_at: null,
  reason: 'Could not read the deploy checks. Try again in a minute.',
})

/**
 * Deploy state for a fixed report's merged fix, or `null` (not fixed, no
 * merged attempt, or no deploy target ever observed). Up to three small
 * project-scoped reads; never throws.
 */
export async function loadReportDeployLive(
  db: SupabaseClient,
  report: { project_id: string; status: string | null },
  fixes: ReadonlyArray<{ merged_at?: string | null }>,
): Promise<ReportDeployLive | null> {
  if (!reportReadsFixed(report.status)) return null
  const mergedAt = newestMerge(fixes)
  if (!mergedAt) return null
  const projectId = report.project_id
  try {
    const [runsRes, obsRes] = await Promise.all([
      db
        .from('gate_runs')
        .select('id, status, started_at, completed_at, commit_sha')
        .eq('project_id', projectId)
        .eq('gate', 'deploy_drift')
        .order('started_at', { ascending: false })
        .limit(5),
      db
        .from('deploy_observations')
        .select('target_id, ok, observed_commit, observed_at')
        .eq('project_id', projectId)
        .order('observed_at', { ascending: false })
        .limit(100),
    ])
    if (runsRes.error || obsRes.error) return READ_FAILED(mergedAt)
    const run = ((runsRes.data ?? []) as DeployDriftRunRow[]).find((r) => r.status !== 'running') ?? null

    let openNotDeployed = 0
    if (run) {
      const { data: findings, error } = await db
        .from('gate_findings')
        .select('id')
        .eq('gate_run_id', run.id)
        .eq('rule_id', 'not_deployed')
        .eq('allowlisted', false)
        .limit(50)
      if (error) return READ_FAILED(mergedAt)
      openNotDeployed = (findings ?? []).length
    }
    return deriveDeployLive({
      mergedAt,
      run,
      openNotDeployed,
      observations: (obsRes.data ?? []) as DeployObservationRow[],
    })
  } catch {
    return READ_FAILED(mergedAt)
  }
}
