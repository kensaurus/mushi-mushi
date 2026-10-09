/**
 * FILE: packages/server/supabase/functions/_shared/report-pipelines-close.ts
 * PURPOSE: Close a report's open handoff skill pipelines once the report is
 *          fixed or dismissed.
 *
 * Pipeline 08607674 (workflow-mobile-native-uiux, 8 steps) stayed "pending"
 * after its report was fixed by a merged PR (the-wanting-mind, 2026-10-08):
 * nothing tied a pipeline to its report's outcome, and Pipeline Runs kept
 * listing it as waiting for check-ins.
 *
 * Only handoff runs are closed. A cloud run may have Cursor agents still
 * working; stopping them is the explicit Cancel on the Pipeline Runs page
 * (DELETE /v1/admin/skills/pipelines/:id), which reports per agent.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const OPEN_RUN_STATUSES = ['pending', 'running']
const CLOSING_REPORT_STATUSES = new Set(['fixed', 'resolved', 'dismissed', 'closed'])

/** The note on each skipped step, so the run says why it ended. */
export function pipelineCloseNote(reportStatus: string): string {
  return reportStatus === 'dismissed' || reportStatus === 'closed'
    ? 'Closed: the report was dismissed.'
    : 'Closed: the report was fixed.'
}

export function closesPipelines(reportStatus: string): boolean {
  return CLOSING_REPORT_STATUSES.has(reportStatus)
}

/**
 * Abort the report's open handoff runs and skip their unfinished steps.
 * Best effort: returns the run ids it closed, never throws.
 */
export async function closeReportPipelines(
  db: SupabaseClient,
  input: { reportId: string; projectId: string; reportStatus: string },
): Promise<string[]> {
  if (!closesPipelines(input.reportStatus)) return []
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('skill_pipeline_runs')
    .update({ status: 'aborted', finished_at: now })
    .eq('report_id', input.reportId)
    .eq('project_id', input.projectId)
    .eq('mode', 'handoff')
    .in('status', OPEN_RUN_STATUSES)
    .select('id')
  if (error || !data?.length) return []
  const ids = (data as Array<{ id: string }>).map((r) => r.id)
  await db
    .from('skill_pipeline_step_runs')
    .update({ status: 'skipped', finished_at: now, updated_at: now, notes: pipelineCloseNote(input.reportStatus) })
    .in('run_id', ids)
    .in('status', OPEN_RUN_STATUSES)
  return ids
}
