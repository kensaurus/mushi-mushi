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
 * No env reads: the vitest suite imports it. Only fast-filter imports it, so
 * the size-capped `api` function never bundles it.
 */

import type { getServiceClient } from './db.ts'
import { isAutomatedReportSource } from './report-sources.ts'

type Db = ReturnType<typeof getServiceClient>

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

/**
 * The DB step: close `reportId` as the duplicate child of the open report
 * pickDuplicateParent chooses among `similar`, and count it on the parent.
 * Returns the parent id, or null when nothing merged. A failed read or a
 * report that changed meanwhile merges nothing.
 */
export async function mergeDuplicate(
  db: Db,
  reportId: string,
  projectId: string,
  similar: ReadonlyArray<{ reportId: string; similarity: number }>,
  threshold: number,
): Promise<string | null> {
  if (similar.length === 0) return null
  const { data: me } = await db.from('reports').select('id, source, status, parent_report_id').eq('id', reportId).eq('project_id', projectId).maybeSingle()
  const incoming = me as { id: string; source: string | null; status: string; parent_report_id: string | null } | null
  if (!incoming) return null
  const { data: rows } = await db.from('reports').select('id, status, parent_report_id').eq('project_id', projectId).in('id', similar.map((s) => s.reportId))
  const byId = new Map(((rows ?? []) as Array<{ id: string; status: string; parent_report_id: string | null }>).map((r) => [r.id, r]))
  const candidates: MergeCandidate[] = similar.flatMap((s) => {
    const r = byId.get(s.reportId)
    return r ? [{ id: r.id, similarity: s.similarity, status: r.status, parent_report_id: r.parent_report_id }] : []
  })
  const parent = pickDuplicateParent(incoming, candidates, threshold)
  if (!parent) return null
  const { data: closed, error } = await db
    .from('reports')
    .update({ status: 'dismissed', closed_reason: 'duplicate', parent_report_id: parent.id, updated_at: new Date().toISOString() })
    .eq('id', reportId)
    .eq('status', incoming.status)
    .is('parent_report_id', null)
    .select('id')
  if (error || !closed || (closed as unknown[]).length === 0) return null
  const { data: p } = await db.from('reports').select('custom_metadata').eq('id', parent.id).maybeSingle()
  await db.from('reports').update({ custom_metadata: withDuplicateCounted((p as { custom_metadata?: Record<string, unknown> | null } | null)?.custom_metadata, reportId) }).eq('id', parent.id)
  return parent.id
}
