/**
 * FILE: packages/server/supabase/functions/_shared/sibling-dispatch.ts
 * PURPOSE: The fix_dispatch_jobs row fix-worker queues for a sibling repo when
 *          a fix spans several repos (cross-repo fan-out).
 *
 * `skill` is 'dispatch_fix': the column default and the skill every fix
 * dispatch carries (A2A dedupes on it). It used to be 'fix', which
 * fix_dispatch_jobs_skill_check rejects — every sibling insert failed and the
 * error was logged as non-fatal. A sibling job is started by Mushi, not a
 * person, so its trigger is 'automatic' and the auto-fix caps apply.
 *
 * Pure: no Deno globals, no I/O.
 */

export function siblingDispatchRow(args: {
  projectId: string
  reportId: string
  coordinationId: string
  sibling: { id: string; repo_url: string }
  prUrl: string
  siblingCount: number
}): Record<string, unknown> {
  return {
    project_id: args.projectId,
    report_id: args.reportId,
    coordination_id: args.coordinationId,
    skill: 'dispatch_fix',
    status: 'queued',
    dispatch_metadata: {
      trigger: 'automatic',
      target_repo_id: args.sibling.id,
      target_repo_url: args.sibling.repo_url,
      coordinated_with_pr: args.prUrl,
      sibling_count: args.siblingCount,
    },
  }
}
