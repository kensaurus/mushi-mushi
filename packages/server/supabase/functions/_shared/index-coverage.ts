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
import { shouldIndex } from './code-indexer.ts'
import { pathMatchesAnyGlob, type CodebaseScopeSettings } from './codebase-scope.ts'

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
 * Which files this sweep fetches: at most `runBudget` paths. Frame files
 * (known fix sites) always go first; then every file new to the index, in
 * prioritizeSweepFiles order, while the index holds fewer than `planCap`
 * eligible files; then refreshes of indexed files. New files of any tier
 * come before refreshes so a filling repo always makes progress: a repo
 * whose source is indexed but whose tests are not used to spend the whole
 * budget re-fetching source and never fill (pushes keep indexed files fresh).
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
  const refresh: string[] = []
  for (const p of ordered) {
    if (out.length >= budget) break
    const isNew = !input.indexedPaths.has(p)
    if (frames.has(p)) {
      out.push(p)
      if (isNew) room = Math.max(0, room - 1)
      continue
    }
    if (!isNew) {
      refresh.push(p)
      continue
    }
    if (room === 0) continue
    room--
    out.push(p)
  }
  for (const p of refresh) {
    if (out.length >= budget) break
    out.push(p)
  }
  return out
}

/**
 * Null when the eligible set is fine; otherwise the error a sweep records
 * instead of coverage. A project scope or path filter that matches none of
 * the repo's indexable files would otherwise measure "0 of 0 files,
 * complete" while the index still holds the old files.
 */
export function emptyEligibleError(input: {
  indexableFiles: number
  eligibleFiles: number
  pathGlobs: readonly string[] | null
}): string | null {
  if (input.eligibleFiles > 0 || input.indexableFiles === 0) return null
  const globs = (input.pathGlobs ?? []).filter((g) => g.trim() !== '')
  return (
    `filter_matches_nothing: the codebase scope${globs.length > 0 ? ` and path filter (${globs.join(', ')})` : ''} ` +
    `match none of the ${input.indexableFiles.toLocaleString('en-US')} indexable files in this repo; nothing was indexed. ` +
    'Fix the path filter on the Codebase indexing card (or the scope in Settings).'
  ).slice(0, 500)
}

/**
 * Which repo files the index may hold: a supported source file outside the
 * skip list, inside the project's codebase scope (scope paths and excludes)
 * and matching the repo's path filter (`project_repos.path_globs`, the
 * console's "Path filter"). The sweep and the push path share it, so a path
 * filter changes both what is fetched and what counts as eligible.
 */
export function indexPathFilter(input: {
  scope: CodebaseScopeSettings | null
  pathGlobs: readonly string[] | null
}): (path: string) => boolean {
  return (path) => shouldIndex(path, input.scope) && pathMatchesAnyGlob(path, input.pathGlobs)
}

/**
 * Indexed files the current scope or path filter now excludes: present in the
 * repo's tree, indexable, but outside the filter. A sweep tombstones them, so
 * narrowing a filter shrinks the index (and what diagnoses see) instead of
 * leaving the old files stored past the plan cap. Files missing from the tree
 * are left alone (a truncated tree does not list every file).
 */
export function pathsOutsideFilter(input: {
  indexedPaths: ReadonlySet<string>
  /** Indexable blob paths in the tree, before the scope and path filter. */
  indexableTreePaths: readonly string[]
  eligible: (path: string) => boolean
}): string[] {
  const out: string[] = []
  for (const p of input.indexableTreePaths) {
    if (input.indexedPaths.has(p) && !input.eligible(p)) out.push(p)
  }
  return out
}

/**
 *   complete: every storable eligible file is indexed and the tree was whole.
 *   filling:  short of both the repo and the plan ceiling; the hourly sweep
 *             adds files.
 *   capped:   the plan ceiling is reached (or GitHub truncated the tree).
 *   stalled:  would be filling, but the last sweep added no file (fetches or
 *             embeddings keep failing). Swept on the normal staleness
 *             cadence instead of hourly, with the reason in last_index_error.
 */
export type IndexCoverageState = 'complete' | 'filling' | 'capped' | 'stalled'

export const INDEX_COVERAGE_STATES: readonly IndexCoverageState[] = ['complete', 'filling', 'capped', 'stalled']

export function isIndexCoverageState(v: unknown): v is IndexCoverageState {
  return typeof v === 'string' && (INDEX_COVERAGE_STATES as readonly string[]).includes(v)
}

/** State from counts alone (no progress check). */
function classifyCoverage(indexed: number, eligible: number, cap: number, truncated: boolean): 'complete' | 'filling' | 'capped' {
  if (indexed >= eligible && !truncated) return 'complete'
  if (indexed >= cap || (truncated && indexed >= eligible)) return 'capped'
  return 'filling'
}

export interface IndexCoverage {
  indexed: number
  eligible: number
  cap: number
  truncated: boolean
  state: IndexCoverageState
}

/** The sweep fetches at most this many characters of one file (fetchFileContents). */
export const MAX_INDEXED_FILE_BYTES = 500_000

/**
 * Whether a tree blob can ever be stored: an empty file has nothing to embed
 * and one over the fetch limit is never read, so counting either as
 * "eligible" would keep coverage short of complete forever. A blob without a
 * size (older listings) is assumed storable.
 */
export function isStorableBlob(entry: { size?: number }): boolean {
  return entry.size == null || (entry.size > 0 && entry.size <= MAX_INDEXED_FILE_BYTES)
}

/**
 * Coverage after a sweep: `indexedPaths` is what the index holds now (read
 * back after the writes), intersected with the repo's eligible files.
 * `unstorablePaths` are eligible files this run fetched and found missing,
 * empty or over the limit: they can never be indexed, so they leave the
 * eligible count instead of keeping the repo "filling" forever. (A transient
 * fetch or embedding failure is not unstorable; the next sweep retries it.)
 *   complete: every storable eligible file is indexed and the tree was whole.
 *   capped:   the plan ceiling is reached (or GitHub truncated the tree),
 *             so more sweeps will not add files.
 *   filling:  below both; the next sweeps add files.
 */
export function measureIndexCoverage(input: {
  eligiblePaths: readonly string[]
  indexedPaths: ReadonlySet<string>
  unstorablePaths?: ReadonlySet<string>
  cap: number
  truncated: boolean
  /**
   * Eligible files the index held before this sweep. When given, a sweep that
   * would leave the repo filling without adding a file reads as stalled.
   */
  indexedBefore?: number
}): IndexCoverage {
  const unstorable = input.unstorablePaths ?? new Set<string>()
  let eligible = 0
  let indexed = 0
  for (const p of input.eligiblePaths) {
    if (input.indexedPaths.has(p)) {
      eligible++
      indexed++
    } else if (!unstorable.has(p)) {
      eligible++
    }
  }
  let state: IndexCoverageState = classifyCoverage(indexed, eligible, input.cap, input.truncated)
  if (state === 'filling' && input.indexedBefore !== undefined && indexed <= input.indexedBefore) state = 'stalled'
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
  /** Last file-fetch failure of this sweep, for the stalled reason. */
  lastFetchError?: string
  /** Files this sweep could not fetch (transient errors). */
  fetchErrors?: number
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
    last_index_error: sweepErrorText(input),
    index_files_indexed: coverage.indexed,
    index_files_eligible: coverage.eligible,
    index_file_cap: coverage.cap,
    index_tree_truncated: coverage.truncated,
    index_coverage_state: coverage.state,
  }
}

/** The project_repos columns handleSweep writes after a non-targeted sweep. */
export interface SweepRepoUpdate {
  last_index_attempt_at: string
  last_index_error: string | null
  index_swept_at?: string
  last_indexed_at?: string
  index_files_indexed: number
  index_files_eligible: number
  index_file_cap: number
  index_tree_truncated: boolean
  index_coverage_state: IndexCoverageState
}

/**
 * What handleSweep records for one non-targeted sweep, success or not.
 *
 * A sweep that embedded nothing and lost chunks (`inserted === 0 &&
 * failed > 0`) is a failed run, but how it is recorded depends on coverage:
 *   - filling or stalled: the full sweep bookkeeping, so a repo whose only
 *     unindexed files always fail embedding reads as stalled and drops to the
 *     daily cadence. Recording only the error left it `filling`, and the
 *     hourly batch picked it up again forever (gap 16b).
 *   - complete or capped: the coverage numbers and the error, but not
 *     `index_swept_at`. The console and doctor read it as a failed sweep
 *     (attempt later than the last sweep), and the next sweep retries it once
 *     the staleness cutoff passes, as before.
 */
export function sweepOutcome(input: {
  inserted: number
  failed: number
  lastError?: string
  fetchErrors: number
  lastFetchError?: string
  coverage: IndexCoverage
  nowIso: string
}): { ok: boolean; error: string | null; update: SweepRepoUpdate } {
  const bookkeeping = sweepBookkeeping({
    coverage: input.coverage,
    nowIso: input.nowIso,
    failedChunks: input.failed,
    lastError: input.lastError,
    fetchErrors: input.fetchErrors,
    lastFetchError: input.lastFetchError,
  })
  if (!(input.inserted === 0 && input.failed > 0)) {
    return { ok: true, error: null, update: bookkeeping }
  }
  const state = input.coverage.state
  if (state === 'filling' || state === 'stalled') {
    return { ok: false, error: bookkeeping.last_index_error, update: bookkeeping }
  }
  const error = (input.lastError ?? 'all chunk embeddings failed').slice(0, 500)
  return {
    ok: false,
    error,
    update: {
      last_index_attempt_at: input.nowIso,
      last_index_error: error,
      index_files_indexed: bookkeeping.index_files_indexed,
      index_files_eligible: bookkeeping.index_files_eligible,
      index_file_cap: bookkeeping.index_file_cap,
      index_tree_truncated: bookkeeping.index_tree_truncated,
      index_coverage_state: bookkeeping.index_coverage_state,
    },
  }
}

function sweepErrorText(input: {
  coverage: IndexCoverage
  failedChunks: number
  lastError?: string
  lastFetchError?: string
  fetchErrors?: number
}): string | null {
  if (input.coverage.state === 'stalled') {
    const why = input.failedChunks > 0
      ? `${input.failedChunks} chunk embedding(s) failed${input.lastError ? ` (${input.lastError})` : ''}`
      : (input.fetchErrors ?? 0) > 0
      ? `${input.fetchErrors} file fetch(es) failed${input.lastFetchError ? ` (${input.lastFetchError})` : ''}`
      : 'no unindexed file could be fetched'
    return `stalled: the last sweep indexed no new file; ${why}. Retried on the daily sweep.`.slice(0, 500)
  }
  return input.failedChunks > 0 ? (input.lastError ?? 'partial: some chunks failed').slice(0, 500) : null
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
  if (c.state === 'stalled') return `${of} indexed; the last sweep added none (see the index error)`
  return `${of} indexed so far; the hourly sweep adds more`
}

/**
 * Which changed files one push embeds (gap 16b: the plan ceiling binds pushes
 * too). Files already in the index are always refreshed; a file new to the
 * index is admitted only while the index holds fewer than `cap` files.
 */
export function admitPushPaths(input: {
  /** Eligible added/modified paths, deduped. */
  candidates: readonly string[]
  /** Which of the candidates the index already holds. */
  indexed: ReadonlySet<string>
  /** Eligible files in the index before this push. */
  indexedCount: number
  cap: number
}): { admit: string[]; overCap: string[] } {
  let room = Math.max(0, input.cap - input.indexedCount)
  const admit: string[] = []
  const overCap: string[] = []
  for (const p of input.candidates) {
    if (input.indexed.has(p)) {
      admit.push(p)
    } else if (room > 0) {
      admit.push(p)
      room--
    } else {
      overCap.push(p)
    }
  }
  return { admit, overCap }
}

/**
 * The coverage columns after a push, from the last measurement plus what the
 * push changed. Null when nothing was measured yet (the first sweep measures
 * the tree). A push does not move `index_swept_at`: the daily sweep still runs
 * and reconciles anything a push missed (a dropped delivery, a force push).
 * A push that adds files to a stalled repo puts it back to filling, so the
 * hourly sweep tries again.
 */
export function pushCoverageUpdate(input: {
  prev: { indexed: number | null; eligible: number | null; truncated: boolean | null; state: string | null }
  cap: number
  /** Eligible files the push added to the repo (commit `added`, net of removals). */
  addedToRepo: number
  /** Eligible files the push removed from the repo (net of re-adds). */
  removedFromRepo: number
  /** Files new to the index that the push wrote. */
  newlyIndexed: number
  /** Indexed files the push tombstoned. */
  unindexed: number
}): {
  index_files_indexed: number
  index_files_eligible: number
  index_file_cap: number
  index_coverage_state: IndexCoverageState
} | null {
  const { prev } = input
  if (prev.indexed == null || prev.eligible == null || !isIndexCoverageState(prev.state)) return null
  const indexed = Math.max(0, prev.indexed + input.newlyIndexed - input.unindexed)
  const eligible = Math.max(indexed, prev.eligible + input.addedToRepo - input.removedFromRepo)
  let state: IndexCoverageState = classifyCoverage(indexed, eligible, input.cap, prev.truncated === true)
  // Still filling with nothing new to try: keep the stall until a sweep or a
  // push makes progress, so a stalled repo does not rejoin the hourly batch.
  if (state === 'filling' && prev.state === 'stalled' && input.newlyIndexed === 0 && input.addedToRepo === 0) state = 'stalled'
  return {
    index_files_indexed: indexed,
    index_files_eligible: eligible,
    index_file_cap: input.cap,
    index_coverage_state: state,
  }
}

/** The project_repos columns the doctor's codebase-index check reads. */
export interface IndexDoctorRepo {
  last_indexed_at: string | null
  last_index_error: string | null
  index_swept_at?: string | null
  index_files_indexed?: number | null
  index_files_eligible?: number | null
  index_file_cap?: number | null
  index_tree_truncated?: boolean | null
  index_coverage_state?: string | null
}

export interface IndexDoctorCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  summary: string
  hint?: string
}

/**
 * The doctor's per-project codebase-index check. A stalled repo always has a
 * `stalled:` last_index_error (sweepErrorText), so it is classified before
 * the generic error branch: it gets its coverage numbers and the reason, not
 * only "Index issue".
 */
export function codebaseIndexDoctorCheck(projectId: string, repo: IndexDoctorRepo | null | undefined): IndexDoctorCheck {
  const name = `codebase_index:${projectId}`
  // A partial sweep (plan cap, or still filling) sets index_swept_at only.
  const sweptAt = repo ? latestIso(repo.last_indexed_at, repo.index_swept_at) : null
  if (!repo || !sweptAt) {
    return {
      name,
      status: 'fail',
      summary: 'Codebase indexing is enabled but no sweep has completed — diagnoses run without code context.',
      hint: 'Re-run the sweep from the console Integrations card, and verify the GitHub App installation.',
    }
  }
  const coverage = describeIndexCoverage({
    indexed: repo.index_files_indexed ?? null,
    eligible: repo.index_files_eligible ?? null,
    cap: repo.index_file_cap ?? null,
    truncated: repo.index_tree_truncated === true,
    state: repo.index_coverage_state ?? null,
  })
  const state = repo.index_coverage_state ?? null
  if (state === 'stalled') {
    const reason = repo.last_index_error ? repo.last_index_error.replace(/^stalled:\s*/, '').slice(0, 200) : null
    return {
      name,
      status: 'warn',
      summary: `Index stalled: ${coverage ?? 'coverage unknown'} (last sweep ${sweptAt}).${reason ? ` Reason: ${reason}` : ''}`,
      hint: 'The last sweep added no file. Fix the reason, then re-run the sweep from the Integrations card; until then it is retried daily.',
    }
  }
  if (repo.last_index_error) {
    return {
      name,
      status: 'warn',
      summary: `Index issue: ${repo.last_index_error.slice(0, 200)}${coverage ? ` (coverage: ${coverage})` : ''}`,
      hint: repo.last_index_error.startsWith('partial:')
        ? 'Some chunks failed to embed; the next sweep retries them.'
        : 'Fix the recorded error, then re-run the sweep from the Integrations card.',
    }
  }
  if (state === 'filling' || state === 'capped') {
    return {
      name,
      status: 'warn',
      summary: `Partly indexed: ${coverage ?? 'coverage unknown'} (last sweep ${sweptAt}).`,
      hint: state === 'capped'
        ? 'Diagnoses only see the indexed files. A higher plan indexes more files; a path filter on the Integrations card narrows the sweep to the files that matter.'
        : 'The hourly sweep keeps adding files until the repo or the plan limit is covered.',
    }
  }
  return {
    name,
    status: 'pass',
    summary: coverage ? `Indexed: ${coverage} (last sweep ${sweptAt}).` : `Indexed (last sweep ${sweptAt}).`,
  }
}
