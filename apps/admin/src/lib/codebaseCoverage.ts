/**
 * FILE: apps/admin/src/lib/codebaseCoverage.ts
 * PURPOSE: How the Codebase indexing card reads `GET …/codebase/stats`
 *          coverage (index coverage gaps 16a and 16b). Pure, so the copy and the polling rule
 *          are unit-tested without rendering.
 *
 * Coverage is in files; `indexed_chunks` counts chunks (a file is split
 * into several), so the two are never compared.
 */

/** `stalled`: still short of the repo, but the last sweep added no file. */
export type CoverageState = 'complete' | 'filling' | 'capped' | 'stalled'
export type FileCapSource = 'env' | 'plan_flag' | 'plan_tier' | 'default' | 'unavailable'

export interface CodebaseCoverage {
  indexed_files: number
  eligible_files: number
  file_cap: number | null
  truncated: boolean
  state: CoverageState
  summary: string | null
  measured_at: string | null
}

export interface CodebaseStats {
  codebase_index_enabled: boolean
  repo_url: string | null
  default_branch: string | null
  installation_id: number | null
  indexing_enabled: boolean | null
  path_globs: string[] | null
  /** Chunk rows in the index (kept under its old name for older servers). */
  indexed_files: number
  indexed_chunks?: number
  /** Files the project's plan lets the index hold. */
  file_cap: number
  file_cap_source?: FileCapSource
  plan_id?: string | null
  at_file_cap: boolean
  coverage?: CodebaseCoverage | null
  language_distribution?: Record<string, number>
  /** Last sweep that covered every eligible file. */
  last_indexed_at: string | null
  /** Last successful sweep, complete or partial. */
  index_swept_at?: string | null
  last_index_attempt_at: string | null
  last_index_error: string | null
  has_webhook_secret: boolean
  /** Set for PAT-connected repos: where the repo webhook delivers pushes. */
  push_webhook_path?: string | null
}

const fmt = (n: number) => n.toLocaleString('en-US')

/** Chunks in the index, whichever field the server sent. */
export function indexedChunks(stats: Pick<CodebaseStats, 'indexed_files' | 'indexed_chunks'>): number {
  return stats.indexed_chunks ?? stats.indexed_files
}

/** The later of the complete and partial sweep timestamps. */
export function lastSweptAt(stats: Pick<CodebaseStats, 'last_indexed_at' | 'index_swept_at'>): string | null {
  const a = stats.last_indexed_at
  const b = stats.index_swept_at ?? null
  if (!a) return b
  if (!b) return a
  return Date.parse(b) > Date.parse(a) ? b : a
}

/**
 * Poll while the first sweep has not landed yet. Once any sweep (complete or
 * partial) has written chunks, stop: a partial repo used to poll every 5 s
 * forever because only a complete sweep sets `last_indexed_at`.
 */
export function shouldPollCodebaseStats(stats: CodebaseStats | null, editing: boolean): boolean {
  if (editing || !stats?.codebase_index_enabled) return false
  return !(indexedChunks(stats) > 0 && lastSweptAt(stats))
}

export interface CoverageView {
  value: string
  tone: 'ok' | 'info' | 'warn'
  hint: string
  /** Callout under the rows, when coverage is short of the repo. */
  callout: { tone: 'info' | 'warn'; text: string } | null
}

export function coverageView(c: CodebaseCoverage, fileCap: number): CoverageView {
  const ofRepo = `${fmt(c.indexed_files)} of ${fmt(c.eligible_files)}${c.truncated ? '+' : ''} files`
  if (c.state === 'complete') {
    return { value: `${ofRepo} (all)`, tone: 'ok', hint: 'Every indexable file in the repo is in the index.', callout: null }
  }
  if (c.state === 'filling') {
    return {
      value: ofRepo,
      tone: 'info',
      hint: 'Each sweep fetches a batch of files; the hourly sweep keeps adding files until the repo or your plan limit is covered.',
      callout: {
        tone: 'info',
        text: `Still filling: ${ofRepo} indexed so far. The hourly sweep adds more until it reaches the repo or your plan's ${fmt(fileCap)}-file limit.`,
      },
    }
  }
  if (c.state === 'stalled') {
    return {
      value: ofRepo,
      tone: 'warn',
      hint: 'The last sweep could not add a file (the index error says why). It is retried on the daily sweep.',
      callout: {
        tone: 'warn',
        text: `Stuck at ${ofRepo}: the last sweep added no file. The index error on this card says why; the daily sweep retries, or re-index once it is fixed.`,
      },
    }
  }
  const byTree = c.truncated && c.indexed_files < (c.file_cap ?? fileCap)
  return {
    value: ofRepo,
    tone: 'warn',
    hint: byTree
      ? 'GitHub truncated the file list for this repo, so the sweep cannot see the rest.'
      : "Your plan's file limit is reached; the rest of the repo is not indexed.",
    callout: {
      tone: 'warn',
      text: byTree
        ? `Indexed ${ofRepo}. GitHub returned only part of this repo's file list, so the sweep cannot see the rest of the repo.`
        : `Indexed ${ofRepo}, your plan's ${fmt(c.file_cap ?? fileCap)}-file limit. Diagnoses and fixes only see indexed files. A path filter below limits the sweep (and the count) to the directories that matter, or upgrade for a higher limit.`,
    },
  }
}

/** Hint for the plan-limit row: where the number comes from. */
export function fileCapHint(source: FileCapSource | undefined): string {
  switch (source) {
    case 'env':
      return 'Pinned for every project on this server by MUSHI_REPO_INDEX_SWEEP_FILE_CAP.'
    case 'unavailable':
      return 'Your plan could not be read just now; this is the limit the last sweep used.'
    case 'plan_flag':
    case 'plan_tier':
      return 'Files your plan lets the index hold. Higher plans index more of a large repo.'
    default:
      return 'Files the index may hold for this project.'
  }
}
