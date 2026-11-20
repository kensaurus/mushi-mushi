/**
 * FILE: packages/server/supabase/functions/_shared/duplicate-merge.ts
 * PURPOSE: Grouping that merges (ADR 0063). Similar reports used to get a
 *          shared report_group_id and nothing else: every one of them stayed
 *          open and counted. Now a report Mushi filed itself that matches an
 *          OPEN report of the same app becomes that report's duplicate child
 *          (dismissed, closed_reason 'duplicate', parent_report_id), out of
 *          the open count, and the parent counts it.
 *
 *          A person's report is never closed this way: it keeps the group
 *          only, so their words are never hidden behind a bot's finding.
 *
 * No env reads and no imports beyond pure modules: the vitest suite imports it.
 */

import { isAutomatedReportSource } from './report-sources.ts'

/**
 * The lowest similarity that closes a report as a duplicate. Above the
 * grouping threshold (0.82): code-audit descriptions share a template
 * ("Where: … Fix: … Done when: …"), so two different findings can score
 * 0.85 on the template alone.
 */
export const AUTO_MERGE_MIN_SIMILARITY = 0.9

/** Statuses a duplicate parent may be in: open, or a fix in flight. */
export const MERGE_PARENT_STATUSES: ReadonlySet<string> = new Set(['new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'reopened', 'fixing', 'in_progress'])

export interface MergeCandidate {
  id: string
  similarity: number
  status: string
  parent_report_id: string | null
}

/**
 * The open report an incoming one is a duplicate of, or null. Only an
 * automated incoming report, still open itself and not already a child;
 * the most similar open parent at or above the floor wins.
 */
export function pickDuplicateParent(
  incoming: { id: string; source: string | null; status: string; parent_report_id: string | null },
  candidates: readonly MergeCandidate[],
  threshold: number,
): MergeCandidate | null {
  if (!isAutomatedReportSource(incoming.source)) return null
  if (incoming.parent_report_id || !MERGE_PARENT_STATUSES.has(incoming.status)) return null
  const floor = Math.max(threshold, AUTO_MERGE_MIN_SIMILARITY)
  const ok = candidates
    .filter((c) => c.id !== incoming.id && c.similarity >= floor && !c.parent_report_id && MERGE_PARENT_STATUSES.has(c.status))
    .sort((a, b) => b.similarity - a.similarity)
  return ok[0] ?? null
}

/** The parent's custom_metadata with one more duplicate counted (newest 50 ids kept). */
export function withDuplicateCounted(meta: Record<string, unknown> | null | undefined, childId: string): Record<string, unknown> {
  const m = meta ?? {}
  const prev = Array.isArray(m.duplicate_ids) ? (m.duplicate_ids as unknown[]).filter((x): x is string => typeof x === 'string' && x !== childId) : []
  return { ...m, duplicate_count: (Number(m.duplicate_count) || 0) + 1, duplicate_ids: [...prev, childId].slice(-50) }
}
