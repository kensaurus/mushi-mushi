/**
 * FILE: packages/server/supabase/functions/_shared/modernization-dispatch-db.ts
 * PURPOSE: The reads and writes behind modernization dispatch: file the
 *          report a finding (or a group of minor bumps) is sent to a fix
 *          agent as, link the findings to it, and mark findings `resolved`
 *          once their report is fixed. Rules live in modernization-dispatch.ts.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  FIXED_REPORT_STATUSES,
  findingsToResolve,
  OPEN_FINDING_STATUSES,
  type ModernizationFindingRow,
  type ModernizationReportDraft,
} from './modernization-dispatch.ts'

const IN_CHUNK = 100
const RECONCILE_SCAN = 1000

export const FINDING_COLUMNS =
  'id, project_id, repo_id, dep_name, current_version, suggested_version, manifest_path, summary, severity, changelog_url, related_report_id, status, detected_at'

/**
 * Mark open findings `resolved` when their linked report is fixed, resolved
 * or verified. Idempotent: the update only touches rows still open, so it can
 * run on every read and every cron tick. Never throws; a failure (for
 * example before migration 20261022100100 adds `resolved` to the status
 * CHECK) is returned so the caller can log it and carry on.
 */
export async function reconcileFixedFindings(
  db: SupabaseClient,
  projectIds: string[],
): Promise<{ resolved: number; error: string | null }> {
  if (projectIds.length === 0) return { resolved: 0, error: null }
  try {
    const findings: Array<Pick<ModernizationFindingRow, 'id' | 'status' | 'related_report_id'>> = []
    for (let i = 0; i < projectIds.length; i += IN_CHUNK) {
      const { data, error } = await db
        .from('modernization_findings')
        .select('id, status, related_report_id')
        .in('project_id', projectIds.slice(i, i + IN_CHUNK))
        .in('status', [...OPEN_FINDING_STATUSES])
        .not('related_report_id', 'is', null)
        .limit(RECONCILE_SCAN)
      if (error) return { resolved: 0, error: error.message }
      findings.push(...((data ?? []) as typeof findings))
    }
    const reportIds = [...new Set(findings.map((f) => f.related_report_id).filter((id): id is string => !!id))]
    if (reportIds.length === 0) return { resolved: 0, error: null }
    const status = new Map<string, string>()
    for (let i = 0; i < reportIds.length; i += IN_CHUNK) {
      const { data, error } = await db
        .from('reports')
        .select('id, status')
        .in('id', reportIds.slice(i, i + IN_CHUNK))
        .in('status', [...FIXED_REPORT_STATUSES])
      if (error) return { resolved: 0, error: error.message }
      for (const r of (data ?? []) as Array<{ id: string; status: string }>) status.set(r.id, r.status)
    }
    const ids = findingsToResolve(findings, status)
    if (ids.length === 0) return { resolved: 0, error: null }
    let resolved = 0
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await db
        .from('modernization_findings')
        .update({ status: 'resolved' })
        .in('id', ids.slice(i, i + IN_CHUNK))
        .in('status', [...OPEN_FINDING_STATUSES])
        .select('id')
      if (error) return { resolved, error: error.message }
      resolved += ((data ?? []) as unknown[]).length
    }
    return { resolved, error: null }
  } catch (err) {
    return { resolved: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * File `draft` as a report and link `findingIds` to it (only findings still
 * unlinked). When none could be linked (another dispatch linked them first),
 * the new report is removed again and `linked` is empty: the caller re-reads
 * the finding and uses the report it now has.
 */
export async function fileModernizationReport(
  db: SupabaseClient,
  input: { projectId: string; draft: ModernizationReportDraft; findingIds: string[] },
): Promise<{ reportId: string | null; linked: string[]; error: string | null }> {
  const { data: report, error } = await db
    .from('reports')
    .insert({
      project_id: input.projectId,
      // An automated chore, not a user's widget report (reports_source_check).
      source: 'library_modernizer',
      category: 'other',
      description: input.draft.description,
      summary: input.draft.summary,
      component: input.draft.component,
      severity: input.draft.severity,
      status: 'classified',
      confidence: 0.9,
      bug_ontology_tags: input.draft.bug_ontology_tags,
      reporter_token_hash: 'console:modernization-dispatch',
      environment: input.draft.environment,
    })
    .select('id')
    .single()
  const reportId = (report as { id?: string } | null)?.id ?? null
  if (error || !reportId) return { reportId: null, linked: [], error: error?.message ?? 'report insert failed' }

  const { data: linkedRows, error: linkErr } = await db
    .from('modernization_findings')
    .update({ related_report_id: reportId })
    .in('id', input.findingIds)
    .is('related_report_id', null)
    .select('id')
  const linked = ((linkedRows ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (linkErr || linked.length === 0) {
    await db.from('reports').delete().eq('id', reportId)
    return { reportId: null, linked: [], error: linkErr?.message ?? null }
  }
  return { reportId, linked, error: null }
}
