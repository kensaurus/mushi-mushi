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
 *   live      its commit is a post-merge head and not a pre-fix commit
 *   not_live  its commit is a pre-fix commit and not a post-merge head
 *   unknown   it was not observed since the merge, its probe failed, it
 *             reported no commit, its commit is neither, or it is BOTH (the
 *             head did not move across the merge, so the merge may not have
 *             landed on that branch; `merged_at` can also trail the real
 *             merge when Mushi noticed it late)
 *
 * A newer head the target has not caught up with says nothing about the fix,
 * so open `not_deployed` findings are deliberately not used: a target can be
 * behind head and still run a commit that has the fix.
 *
 * Scope, so a stray row cannot decide the chip:
 *   - Only the production deploy targets declared in the current recipe
 *     manifest count (`deploy.targets`, as recipe-drift `deployDrift` does).
 *     Ad-hoc webhook ids, removed targets and staging targets are ignored.
 *   - The heads come from the project's primary GitHub repo (the GitHub
 *     connector's repo). Every merged attempt of the report must have merged
 *     into that repo; a cross-repo sibling attempt (fix-worker
 *     markCrossRepoSpan) merged elsewhere, whose deploy Mushi does not watch,
 *     so the report can at best be `unknown`. Runs that recorded a different
 *     `summary.head_repo` are dropped.
 *
 * The report: `not_live` when any target is not live (its own commit is
 * `prod_commit`), `live` when every counted target is live, else `unknown`.
 * Only declared targets that ever reported a commit count; a project whose
 * targets only report versions (`sdk_heartbeat` store apps) gets no chip
 * (`null`) rather than a permanent "unknown" (deploy targets are optional
 * recipe context, ADR 0016).
 *
 * Never fails open: a failed read is `unknown`, never `live`.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sameCommit } from './recipe-drift.ts'
import { parseGithubRepoUrl } from './github.ts'

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
  /** `owner/repo` the head was read from (`summary.head_repo`); null on runs written before it was recorded. */
  head_repo: string | null
}

export interface DeployObservationRow {
  target_id: string
  ok: boolean
  observed_commit: string | null
  observed_at: string
}

/** A report's fix attempt, as the detail route selects it. */
export interface MergedFixRow {
  merged_at?: string | null
  pr_url?: string | null
}

/** Newest deploy_drift runs read per report (the collector runs daily). */
const RUN_WINDOW = 120
/** Newest observations read per project (≤ 10 targets, one probe a day each). */
const OBSERVATION_WINDOW = 300

function parsedMergeTime(f: MergedFixRow): number {
  return f.merged_at ? Date.parse(f.merged_at) : NaN
}

function newestMerge(fixes: ReadonlyArray<MergedFixRow>): string | null {
  let best: string | null = null
  let bestT = -Infinity
  for (const f of fixes) {
    const t = parsedMergeTime(f)
    if (!Number.isNaN(t) && t > bestT) {
      bestT = t
      best = f.merged_at as string
    }
  }
  return best
}

/** `owner/repo`, lower-cased, of a GitHub repo or pull-request URL; null when it is not one. */
function githubRepoKey(url: string | null | undefined): string | null {
  if (!url) return null
  const ref = parseGithubRepoUrl(url.split('/pull/')[0])
  return ref ? `${ref.owner}/${ref.repo}`.toLowerCase() : null
}

/** The repo of every merged attempt (null where its PR URL is unreadable). */
function mergedFixRepos(fixes: ReadonlyArray<MergedFixRow>): Array<string | null> {
  return fixes.filter((f) => !Number.isNaN(parsedMergeTime(f))).map((f) => githubRepoKey(f.pr_url))
}

const PRODUCTION_ENVIRONMENTS = new Set(['production', 'prod', 'live'])

/**
 * Ids of the deploy targets declared in a recipe manifest that serve
 * production: no `environment`, or a production one. Mirrors how
 * recipe-phase2 reads `deploy.targets` for deployDrift.
 */
export function declaredProductionTargets(manifest: unknown): Set<string> {
  const deploy = (manifest as { deploy?: { targets?: unknown } } | null)?.deploy
  const targets: unknown[] = Array.isArray(deploy?.targets) ? deploy.targets : []
  const out = new Set<string>()
  for (const t of targets) {
    const row = t as { id?: unknown; environment?: unknown } | null
    if (typeof row?.id !== 'string' || !row.id.trim()) continue
    const env = typeof row.environment === 'string' ? row.environment.trim().toLowerCase() : ''
    if (env && !PRODUCTION_ENVIRONMENTS.has(env)) continue
    out.add(row.id)
  }
  return out
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

function unknownChip(mergedAt: string, reason: string): ReportDeployLive {
  return { state: 'unknown', merged_at: mergedAt, prod_commit: null, target_id: null, checked_at: null, reason }
}

/**
 * Why the deploy heads cannot speak for this fix, or null when every merged
 * attempt merged into the repo the heads come from.
 */
function repoMismatch(watchedRepo: string | null, fixRepos: ReadonlyArray<string | null>): string | null {
  if (!watchedRepo) return 'No primary GitHub repo is connected, so Mushi cannot tie the deploys to this fix.'
  if (fixRepos.length === 0 || fixRepos.some((r) => r === null)) {
    return 'Mushi cannot tell which repo this fix merged into.'
  }
  const foreign = fixRepos.find((r) => r !== watchedRepo)
  if (foreign) return `This fix merged into ${foreign}, but the deploy checks follow ${watchedRepo}.`
  return null
}

/**
 * Pure: the deploy state of a merged fix from the project's deploy_drift runs
 * and deploy observations (any order, any time). `null` when no declared
 * production deploy target ever reported a commit.
 */
export function deriveDeployLive(input: {
  mergedAt: string
  /** `owner/repo` of every merged attempt of the report (null = unreadable PR URL). */
  fixRepos: ReadonlyArray<string | null>
  /** `owner/repo` the deploy_drift heads come from (the project's primary repo); null when none. */
  watchedRepo: string | null
  /** Production deploy target ids declared in the current recipe manifest. */
  declaredTargets: ReadonlySet<string>
  runs: readonly DeployDriftRunRow[]
  observations: readonly DeployObservationRow[]
}): ReportDeployLive | null {
  const { mergedAt } = input
  const mergedT = Date.parse(mergedAt)
  const observations = input.observations.filter((o) => input.declaredTargets.has(o.target_id))

  // Only targets that ever reported a commit can be placed before or after the merge.
  const committed = new Set(observations.filter(hasCommit).map((o) => o.target_id))
  if (committed.size === 0) return null

  // The heads speak only for the repo they were read from.
  const watchedRepo = input.watchedRepo?.toLowerCase() ?? null
  const mismatch = repoMismatch(watchedRepo, input.fixRepos.map((r) => r?.toLowerCase() ?? null))
  if (mismatch) return unknownChip(mergedAt, mismatch)

  const latest = latestPerTarget(observations).filter((o) => committed.has(o.target_id))

  const postHeads: string[] = []
  const preFix: string[] = []
  for (const r of input.runs) {
    const sha = r.commit_sha?.trim()
    if (!sha) continue
    if (r.head_repo && r.head_repo.toLowerCase() !== watchedRepo) continue
    if (Date.parse(r.started_at) >= mergedT) postHeads.push(sha)
    else if (r.completed_at && Date.parse(r.completed_at) < mergedT) preFix.push(sha)
  }
  for (const o of observations) {
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
    const isPostHead = postHeads.some((h) => sameCommit(commit, h))
    const isPreFix = preFix.some((c) => sameCommit(commit, c))
    // The head did not move across the merge: the merge may not have reached
    // this branch, or merged_at trails the real merge. Neither proves a state.
    if (isPostHead && isPreFix) {
      return {
        state: 'unknown',
        obs: o,
        reason: `${o.target_id} runs a commit that was the default-branch head both before and after this fix merged, so Mushi cannot tell whether it has the fix.`,
      }
    }
    if (isPostHead) return { state: 'live', obs: o }
    if (isPreFix) return { state: 'not_live', obs: o }
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

const READ_FAILED = (mergedAt: string): ReportDeployLive =>
  unknownChip(mergedAt, 'Could not read the deploy checks. Try again in a minute.')

function headRepoOf(summary: unknown): string | null {
  const v = (summary as { head_repo?: unknown } | null)?.head_repo
  return typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null
}

/**
 * Deploy state for a fixed report's merged fix, or `null` (not fixed, no
 * merged attempt, no production deploy target declared in the current
 * recipe manifest, or none of them ever reported a commit). A handful of
 * small project-scoped reads; never throws.
 */
export async function loadReportDeployLive(
  db: SupabaseClient,
  report: { project_id: string; status: string | null },
  fixes: ReadonlyArray<MergedFixRow>,
): Promise<ReportDeployLive | null> {
  if (!reportReadsFixed(report.status)) return null
  const mergedAt = newestMerge(fixes)
  if (!mergedAt) return null
  const projectId = report.project_id
  try {
    const [snapRes, repoRes, runsRes, obsRes] = await Promise.all([
      db
        .from('app_recipe_snapshots')
        .select('manifest')
        .eq('project_id', projectId)
        .eq('is_current', true)
        .maybeSingle(),
      db
        .from('project_repos')
        .select('repo_url')
        .eq('project_id', projectId)
        .eq('is_primary', true)
        .maybeSingle(),
      db
        .from('gate_runs')
        .select('id, status, started_at, completed_at, commit_sha, summary')
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
    if (snapRes.error || repoRes.error || runsRes.error || obsRes.error) return READ_FAILED(mergedAt)
    const declaredTargets = declaredProductionTargets((snapRes.data as { manifest?: unknown } | null)?.manifest ?? null)
    if (declaredTargets.size === 0) return null
    const watchedRepo = githubRepoKey((repoRes.data as { repo_url?: string | null } | null)?.repo_url ?? null)
    const runs = ((runsRes.data ?? []) as Array<Omit<DeployDriftRunRow, 'head_repo'> & { summary?: unknown }>).map(
      ({ summary, ...r }): DeployDriftRunRow => ({ ...r, head_repo: headRepoOf(summary) }),
    )
    const observations = ((obsRes.data ?? []) as DeployObservationRow[]).filter((o) => declaredTargets.has(o.target_id))

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
        .in('target_id', [...declaredTargets])
        .in('observed_commit', current)
        .lt('observed_at', mergedAt)
        .limit(50)
      if (error) return READ_FAILED(mergedAt)
      earlier = (data ?? []) as DeployObservationRow[]
    }
    return deriveDeployLive({
      mergedAt,
      fixRepos: mergedFixRepos(fixes),
      watchedRepo,
      declaredTargets,
      runs,
      observations: [...observations, ...earlier],
    })
  } catch {
    return READ_FAILED(mergedAt)
  }
}
