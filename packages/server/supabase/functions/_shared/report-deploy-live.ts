/**
 * FILE: _shared/report-deploy-live.ts
 * PURPOSE: "Fixed — not live yet (prod is on <sha>)" vs "Fixed and live" on a
 *          report whose fix PR merged (completeness gap #10, Plan 019 Phase 2).
 *
 * A fix merge stores no merge-commit SHA, so every claim is built from commit
 * identity plus time, per deploy target:
 *
 *   post-merge heads  `commit_sha` of `deploy_drift` runs that STARTED at or
 *                     after the merge. recipe-collector reads the default-branch
 *                     head during the run, so these heads contain the fix.
 *   pre-fix commits   `commit_sha` of runs that COMPLETED before the merge (a
 *                     run that straddles the merge proves nothing), and any
 *                     commit a target was observed running before the merge.
 *                     Neither can contain a commit that did not exist yet.
 *
 * Each target's newest observation is then:
 *   live      its commit is a post-merge head
 *   not_live  its commit is a pre-fix commit (positive evidence only)
 *   unknown   it was not observed since the merge, its probe failed, it
 *             reported no commit, or its commit is neither (for example a
 *             post-merge commit no run ever sampled)
 *
 * A newer head the target has not caught up with says nothing about the fix,
 * so open `not_deployed` findings are deliberately not used: a target can be
 * behind head and still run a commit that has the fix.
 *
 * The report: `not_live` when any target is not live (its own commit is
 * `prod_commit`), `live` when every counted target is live, else `unknown`.
 * Only targets that ever reported a commit count; a project whose targets
 * only report versions (`sdk_heartbeat` store apps) gets no chip (`null`)
 * rather than a permanent "unknown" (deploy targets are optional recipe
 * context, ADR 0016).
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
  /** The commit the deciding deploy target runs, when it reported one. */
  prod_commit: string | null
  /** The deploy target `prod_commit` was read from. */
  target_id: string | null
  /** When that observation was taken. */
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

/** Newest deploy_drift runs read per report (the collector runs daily). */
const RUN_WINDOW = 120
/** Newest observations read per project (≤ 10 targets, one probe a day each). */
const OBSERVATION_WINDOW = 300

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

function hasCommit(o: DeployObservationRow): o is DeployObservationRow & { observed_commit: string } {
  return typeof o.observed_commit === 'string' && o.observed_commit.trim().length > 0
}

/** Newest observation per target, newest first (input may be in any order). */
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

type TargetVerdict =
  | { state: 'live'; obs: DeployObservationRow & { observed_commit: string } }
  | { state: 'not_live'; obs: DeployObservationRow & { observed_commit: string } }
  | { state: 'unknown'; obs: DeployObservationRow; reason: string }

/**
 * Pure: the deploy state of a merged fix from the project's deploy_drift runs
 * and deploy observations (any order, any time). `null` when no deploy target
 * ever reported a commit.
 */
export function deriveDeployLive(input: {
  mergedAt: string
  runs: readonly DeployDriftRunRow[]
  observations: readonly DeployObservationRow[]
}): ReportDeployLive | null {
  const { mergedAt } = input
  const mergedT = Date.parse(mergedAt)

  // Only targets that ever reported a commit can be placed before or after the merge.
  const committed = new Set(input.observations.filter(hasCommit).map((o) => o.target_id))
  if (committed.size === 0) return null
  const latest = latestPerTarget(input.observations).filter((o) => committed.has(o.target_id))

  const postHeads: string[] = []
  const preFix: string[] = []
  for (const r of input.runs) {
    const sha = r.commit_sha?.trim()
    if (!sha) continue
    if (Date.parse(r.started_at) >= mergedT) postHeads.push(sha)
    else if (r.completed_at && Date.parse(r.completed_at) < mergedT) preFix.push(sha)
  }
  for (const o of input.observations) {
    if (o.ok && hasCommit(o) && Date.parse(o.observed_at) < mergedT) preFix.push(o.observed_commit)
  }
  const checkedSinceMerge = postHeads.length > 0

  const verdicts: TargetVerdict[] = latest.map((o): TargetVerdict => {
    // What a target ran before the merge says nothing about what it runs now.
    if (Date.parse(o.observed_at) < mergedT) {
      return { state: 'unknown', obs: o, reason: `${o.target_id} has not been checked since this fix merged.` }
    }
    if (!o.ok) return { state: 'unknown', obs: o, reason: `The last deploy check for ${o.target_id} failed.` }
    if (!hasCommit(o)) return { state: 'unknown', obs: o, reason: `${o.target_id} did not report a commit in its last deploy check.` }
    const commit = o.observed_commit
    if (postHeads.some((h) => sameCommit(commit, h))) return { state: 'live', obs: o }
    if (preFix.some((c) => sameCommit(commit, c))) return { state: 'not_live', obs: o }
    return {
      state: 'unknown',
      obs: o,
      reason: checkedSinceMerge
        ? `${o.target_id} runs a commit Mushi cannot place before or after this fix merged.`
        : 'Deploys have not been checked since this fix merged.',
    }
  })

  const notLive = verdicts.find((v) => v.state === 'not_live')
  if (notLive) {
    return {
      state: 'not_live',
      merged_at: mergedAt,
      prod_commit: notLive.obs.observed_commit,
      target_id: notLive.obs.target_id,
      checked_at: notLive.obs.observed_at,
      reason: `${notLive.obs.target_id} still runs a commit from before this fix merged.`,
    }
  }
  if (verdicts.length > 0 && verdicts.every((v) => v.state === 'live')) {
    const first = verdicts[0].obs
    return {
      state: 'live',
      merged_at: mergedAt,
      prod_commit: first.observed_commit,
      target_id: first.target_id,
      checked_at: first.observed_at,
      reason: 'Every deploy target runs a default-branch commit from after this fix merged.',
    }
  }
  const unknown = verdicts.find((v): v is Extract<TargetVerdict, { state: 'unknown' }> => v.state === 'unknown')
  const obs = unknown?.obs ?? null
  return {
    state: 'unknown',
    merged_at: mergedAt,
    prod_commit: obs && hasCommit(obs) ? obs.observed_commit : null,
    target_id: obs?.target_id ?? null,
    checked_at: obs?.observed_at ?? null,
    reason: unknown?.reason ?? 'Deploys have not been checked since this fix merged.',
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
 * merged attempt, or no deploy target ever reported a commit). Up to three
 * small project-scoped reads; never throws.
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
        .limit(RUN_WINDOW),
      db
        .from('deploy_observations')
        .select('target_id, ok, observed_commit, observed_at')
        .eq('project_id', projectId)
        .order('observed_at', { ascending: false })
        .limit(OBSERVATION_WINDOW),
    ])
    if (runsRes.error || obsRes.error) return READ_FAILED(mergedAt)
    const runs = (runsRes.data ?? []) as DeployDriftRunRow[]
    const observations = (obsRes.data ?? []) as DeployObservationRow[]

    // A commit some target ran before the merge cannot contain the fix. The
    // newest-first window may not reach back that far, so look the current
    // commits up directly.
    const current = [...new Set(latestPerTarget(observations).filter(hasCommit).map((o) => o.observed_commit))]
    let earlier: DeployObservationRow[] = []
    if (current.length > 0) {
      const { data, error } = await db
        .from('deploy_observations')
        .select('target_id, ok, observed_commit, observed_at')
        .eq('project_id', projectId)
        .eq('ok', true)
        .in('observed_commit', current)
        .lt('observed_at', mergedAt)
        .limit(50)
      if (error) return READ_FAILED(mergedAt)
      earlier = (data ?? []) as DeployObservationRow[]
    }
    return deriveDeployLive({ mergedAt, runs, observations: [...observations, ...earlier] })
  } catch {
    return READ_FAILED(mergedAt)
  }
}
