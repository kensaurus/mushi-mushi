/**
 * FILE: apps/admin/src/components/fixes/types.ts
 * PURPOSE: Shared types + tiny look-up tables for the FixesPage and its
 *          subcomponents. Extracted so the page itself can stay focused on
 *          orchestration.
 */

export interface FixAttempt {
  id: string
  report_id: string
  agent: string
  status: string
  branch?: string
  pr_url?: string
  pr_number?: number
  files_changed?: string[]
  lines_changed?: number
  summary?: string
  rationale?: string
  review_passed?: boolean
  error?: string
  started_at: string
  completed_at?: string
  langfuse_trace_id?: string | null
  llm_model?: string | null
  llm_input_tokens?: number | null
  llm_output_tokens?: number | null
  check_run_status?: string | null
  check_run_conclusion?: string | null
}

export interface DispatchJob {
  id: string
  project_id: string
  report_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  pr_url?: string
  error?: string
  created_at: string
  started_at?: string
  finished_at?: string
}

export interface FixSummary {
  total: number
  completed: number
  failed: number
  inProgress: number
  prsOpen: number
  prsMerged: number
  days: { day: string; total: number; completed: number; failed: number }[]
}

export const DISPATCH_STATUS: Record<DispatchJob['status'], string> = {
  queued: 'bg-surface-overlay text-fg-muted',
  running: 'bg-info-subtle text-info',
  completed: 'bg-ok-subtle text-ok',
  failed: 'bg-danger-subtle text-danger',
  cancelled: 'bg-surface-overlay text-fg-faint',
}

export const DISPATCH_STATUS_LABEL: Record<DispatchJob['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const CHECK_RUN_TONE: Record<string, string> = {
  success: 'bg-ok-subtle text-ok',
  failure: 'bg-danger-subtle text-danger',
  cancelled: 'bg-surface-overlay text-fg-muted',
  timed_out: 'bg-warning-subtle text-warning',
  action_required: 'bg-warning-subtle text-warning',
  neutral: 'bg-surface-overlay text-fg-muted',
  in_progress: 'bg-info-subtle text-info',
  queued: 'bg-info-subtle text-info',
  pending: 'bg-info-subtle text-info',
}

/**
 * Surfaces what we actually know about a fix's CI run. Returns null when the
 * GitHub webhook hasn't fired yet — better empty than a faked "passed".
 */
export function ciBadge(fix: FixAttempt): { label: string; className: string } | null {
  const conclusion = fix.check_run_conclusion?.toLowerCase()
  const status = fix.check_run_status?.toLowerCase()
  if (conclusion) {
    return { label: `CI: ${conclusion}`, className: CHECK_RUN_TONE[conclusion] ?? 'bg-surface-overlay text-fg-muted' }
  }
  if (status) {
    return { label: `CI: ${status.replace(/_/g, ' ')}`, className: CHECK_RUN_TONE[status] ?? 'bg-surface-overlay text-fg-muted' }
  }
  return null
}
