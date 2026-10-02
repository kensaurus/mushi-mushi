/**
 * FILE: packages/server/supabase/functions/_shared/report-seeds.ts
 * PURPOSE: The repo files one bug report touches, in priority order, for a
 *          report-scoped repo digest ("Copy code for this bug",
 *          get_repo_digest with reportId). Plan 020 §10.3.1.
 *
 * Sources, in order, each capped and each optional:
 *   1. stack frames — `custom_metadata.sentryFrames`, else the stack text
 *      stored in `console_logs` (reports ingested before sentryFrames);
 *   2. files earlier fix attempts changed;
 *   3. related code from the index (RAG on the summary; needs indexing);
 *   4. files that import any of the above (the reverse import graph that
 *      analyze_codebase_impact walks; needs a populated index).
 * Every path must exist in the tree at the pinned commit; index paths can come
 * from another branch, so anything else is dropped. With no index, 3 and 4 add
 * nothing and `sources` says so.
 *
 * Pure: the data sources are injected, so the order, caps and tree filter are
 * unit-tested without a database.
 */

import { framePathsFromStackText, matchFramePathsToTree } from './sentry-frames.ts'

export const MAX_FRAME_FILES = 20
export const MAX_FIX_FILES = 20
export const MAX_RELATED_FILES = 5
export const MAX_DEPENDENTS = 20

export interface ReportForSeeds {
  id: string
  summary: string | null
  component: string | null
  custom_metadata: unknown
  console_logs: unknown
}

export interface ReportSeeds {
  seeds: string[]
  sources: { stack_frames: number; fix_files: number; related_code: number; dependents: number }
}

export interface ReportSeedSources {
  /** files_changed of the report's fix attempts, newest attempt first. */
  fixFiles: () => Promise<string[][]>
  /** File paths related to the summary (RAG), best first. */
  relatedCode: (summary: string, component: string | null) => Promise<string[]>
  /** Files that (transitively) import any of `seeds`. */
  importers: (seeds: string[]) => Promise<string[]>
  warn?: (message: string, detail: Record<string, unknown>) => void
}

/** Frame paths the report carries: stored Sentry frames, else parsed stack text. */
export function reportFramePaths(report: Pick<ReportForSeeds, 'custom_metadata' | 'console_logs'>): string[] {
  const meta = (report.custom_metadata ?? {}) as { sentryFrames?: unknown }
  const stored = Array.isArray(meta.sentryFrames)
    ? meta.sentryFrames.filter((p): p is string => typeof p === 'string')
    : []
  if (stored.length > 0) return stored
  return (Array.isArray(report.console_logs) ? report.console_logs : [])
    .flatMap((l) => framePathsFromStackText((l as { stack?: string } | null)?.stack))
}

export async function resolveReportSeeds(
  report: ReportForSeeds,
  treePaths: readonly string[],
  sources: ReportSeedSources,
): Promise<ReportSeeds> {
  const inTree = new Set(treePaths)
  const seeds: string[] = []
  const add = (paths: readonly string[], cap: number): number => {
    let n = 0
    for (const p of paths) {
      const clean = p.replace(/\\/g, '/').replace(/^\.?\/+/, '')
      if (n >= cap) break
      if (!inTree.has(clean) || seeds.includes(clean)) continue
      seeds.push(clean)
      n++
    }
    return n
  }
  const warn = sources.warn ?? (() => {})

  const stackFrames = add(matchFramePathsToTree(reportFramePaths(report), treePaths), MAX_FRAME_FILES)

  let fixFiles = 0
  try {
    for (const files of await sources.fixFiles()) {
      fixFiles += add(files.filter(Boolean), MAX_FIX_FILES - fixFiles)
    }
  } catch (err) {
    warn('fix files lookup failed', { error: String(err) })
  }

  let relatedCode = 0
  if (report.summary) {
    try {
      relatedCode = add(await sources.relatedCode(report.summary, report.component), MAX_RELATED_FILES)
    } catch (err) {
      warn('related code lookup failed', { error: String(err) })
    }
  }

  let dependents = 0
  if (seeds.length > 0) {
    try {
      const direct = [...seeds]
      dependents = add((await sources.importers(direct)).filter((p) => !direct.includes(p)), MAX_DEPENDENTS)
    } catch (err) {
      warn('import graph lookup failed', { error: String(err) })
    }
  }

  return {
    seeds,
    sources: { stack_frames: stackFrames, fix_files: fixFiles, related_code: relatedCode, dependents },
  }
}
