/**
 * FILE: packages/server/supabase/functions/_shared/index-coverage.ts
 * PURPOSE: How much of a repo the codebase index covers, and how much it may
 *          cover on the project's plan. Pure, no I/O (gap #16a/#16b).
 *
 * Two limits, kept apart on purpose:
 *   - the plan CAP: how many distinct files the index may hold for the
 *     project (the coverage ceiling, set by plan tier);
 *   - the per-run BUDGET: how many files one sweep fetches. Contents are
 *     fetched one by one inside an edge function's wall-clock limit and the
 *     token's GitHub rate limit, so a large cap fills over several sweeps.
 *     Unfinished repos are swept again every hour until they are complete
 *     or capped.
 *
 * A sweep that stops short of the whole repo is partial: it records its
 * coverage and `index_swept_at`, never `last_indexed_at`, which means "the
 * index covered every eligible file".
 */
import { prioritizeSweepFiles } from './sweep-file-priority.ts'

/** Files a plan's index may hold, by plan id. Unknown plans get DEFAULT_INDEX_FILE_CAP. */
export const PLAN_INDEX_FILE_CAPS: Readonly<Record<string, number>> = {
  hobby: 300,
  free_cloud: 300,
  starter: 1_500,
  indie: 1_500,
  pro: 5_000,
  enterprise: 20_000,
}

/** The fixed cap every project had before caps followed the plan. */
export const DEFAULT_INDEX_FILE_CAP = 300
/** loadIndexedPaths pages up to this many paths; a higher cap could not be measured. */
export const MAX_INDEX_FILE_CAP = 20_000
/** Files one sweep fetches, unless MUSHI_REPO_INDEX_SWEEP_RUN_FILES says otherwise. */
export const DEFAULT_SWEEP_RUN_FILES = 300

/** The env var that pins the cap for every project (self-host). */
export const INDEX_FILE_CAP_ENV = 'MUSHI_REPO_INDEX_SWEEP_FILE_CAP'

export type IndexFileCapSource = 'env' | 'plan_flag' | 'plan_tier' | 'default'

export interface IndexFileCap {
  cap: number
  source: IndexFileCapSource
  planId: string | null
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), MAX_INDEX_FILE_CAP) : null
}

/**
 * The coverage ceiling for a project. Precedence:
 *   1. MUSHI_REPO_INDEX_SWEEP_FILE_CAP, when set: an operator pin for every
 *      project (self-host has no billing plans). On Mushi Cloud it must stay
 *      unset, or plan tiers have no effect.
 *   2. `pricing_plans.feature_flags.codebase_index_file_cap`, so a plan's
 *      cap can change by migration without a deploy.
 *   3. PLAN_INDEX_FILE_CAPS by plan id.
 *   4. DEFAULT_INDEX_FILE_CAP.
 */
export function indexFileCapForPlan(
  plan: { id: string; feature_flags?: Record<string, unknown> | null } | null,
  envValue: string | undefined | null,
): IndexFileCap {
  const planId = plan?.id ?? null
  const fromEnv = positiveInt(envValue ?? undefined)
  if (fromEnv !== null) return { cap: fromEnv, source: 'env', planId }
  const fromFlag = positiveInt(plan?.feature_flags?.codebase_index_file_cap)
  if (fromFlag !== null) return { cap: fromFlag, source: 'plan_flag', planId }
  const fromTier = planId ? PLAN_INDEX_FILE_CAPS[planId] : undefined
  if (fromTier !== undefined) return { cap: fromTier, source: 'plan_tier', planId }
  return { cap: DEFAULT_INDEX_FILE_CAP, source: 'default', planId }
}

/**
 * Which files this sweep fetches: at most `runBudget` paths, in
 * prioritizeSweepFiles order (open Sentry frame files, then unindexed
 * application source, …). New files are admitted only while the index holds
 * fewer than `planCap` eligible files; files already in the index are
 * refreshed regardless, and frame files (known fix sites) always go first.
 */
export function selectSweepFiles(input: {
  treePaths: readonly string[]
  framePaths: readonly string[]
  indexedPaths: ReadonlySet<string>
  planCap: number
  runBudget: number
}): string[] {
  const budget = Math.max(0, Math.floor(input.runBudget))
  if (budget === 0) return []
  const ordered = prioritizeSweepFiles(input.treePaths, {
    framePaths: input.framePaths,
    indexedPaths: input.indexedPaths,
    cap: input.treePaths.length,
  })
  const frames = new Set(input.framePaths)
  let indexedEligible = 0
  for (const p of input.treePaths) if (input.indexedPaths.has(p)) indexedEligible++
  let room = Math.max(0, input.planCap - indexedEligible)
  const out: string[] = []
  for (const p of ordered) {
    if (out.length >= budget) break
    const isNew = !input.indexedPaths.has(p)
    if (frames.has(p)) {
      out.push(p)
      if (isNew) room = Math.max(0, room - 1)
      continue
    }
    if (isNew) {
      if (room === 0) continue
      room--
    }
    out.push(p)
  }
  return out
}

export type IndexCoverageState = 'complete' | 'filling' | 'capped'

export interface IndexCoverage {
  indexed: number
  eligible: number
  cap: number
  truncated: boolean
  state: IndexCoverageState
}

/**
 * Coverage after a sweep: `indexedPaths` is what the index holds now (read
 * back after the writes), intersected with the repo's eligible files.
 *   complete: every eligible file is indexed and the tree listing was whole.
 *   capped:   the plan ceiling is reached (or GitHub truncated the tree),
 *             so more sweeps will not add files.
 *   filling:  below both; the next sweeps add files.
 */
export function measureIndexCoverage(input: {
  eligiblePaths: readonly string[]
  indexedPaths: ReadonlySet<string>
  cap: number
  truncated: boolean
}): IndexCoverage {
  const eligible = input.eligiblePaths.length
  let indexed = 0
  for (const p of input.eligiblePaths) if (input.indexedPaths.has(p)) indexed++
  let state: IndexCoverageState
  if (indexed >= eligible && !input.truncated) state = 'complete'
  else if (indexed >= input.cap || (input.truncated && indexed >= eligible)) state = 'capped'
  else state = 'filling'
  return { indexed, eligible, cap: input.cap, truncated: input.truncated, state }
}

/**
 * The project_repos columns a successful (non-targeted) sweep writes.
 * `last_indexed_at` moves only on complete coverage; `index_swept_at` on
 * every successful sweep. `last_index_error` holds real errors only: chunk
 * failures. Partial coverage lives in the coverage columns, not the error.
 */
export function sweepBookkeeping(input: {
  coverage: IndexCoverage
  nowIso: string
  failedChunks: number
  lastError?: string
}): {
  index_swept_at: string
  last_index_attempt_at: string
  last_indexed_at?: string
  last_index_error: string | null
  index_files_indexed: number
  index_files_eligible: number
  index_file_cap: number
  index_tree_truncated: boolean
  index_coverage_state: IndexCoverageState
} {
  const { coverage, nowIso } = input
  return {
    index_swept_at: nowIso,
    last_index_attempt_at: nowIso,
    ...(coverage.state === 'complete' ? { last_indexed_at: nowIso } : {}),
    last_index_error: input.failedChunks > 0 ? (input.lastError ?? 'partial: some chunks failed').slice(0, 500) : null,
    index_files_indexed: coverage.indexed,
    index_files_eligible: coverage.eligible,
    index_file_cap: coverage.cap,
    index_tree_truncated: coverage.truncated,
    index_coverage_state: coverage.state,
  }
}

/** The later of two ISO timestamps (either may be missing). */
export function latestIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return Date.parse(b) > Date.parse(a) ? b : a
}

/** One line for doctor / console: "1,000 of 4,700 files (plan limit 1,000)". */
export function describeIndexCoverage(c: {
  indexed: number | null
  eligible: number | null
  cap: number | null
  truncated: boolean
  state: string | null
}): string | null {
  if (c.indexed == null || c.eligible == null || !c.state) return null
  const n = (x: number) => x.toLocaleString('en-US')
  const of = `${n(c.indexed)} of ${n(c.eligible)}${c.truncated ? '+' : ''} files`
  if (c.state === 'complete') return `${of} indexed`
  if (c.state === 'capped') {
    return c.truncated && c.indexed < (c.cap ?? Infinity)
      ? `${of} indexed (GitHub truncated the file list for this repo)`
      : `${of} indexed (plan limit ${n(c.cap ?? c.indexed)})`
  }
  return `${of} indexed so far; the hourly sweep adds more`
}
