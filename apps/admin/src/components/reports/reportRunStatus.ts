/**
 * FILE: apps/admin/src/components/reports/reportRunStatus.ts
 * PURPOSE: A report's lifecycle state as the console's status mark
 *          (StatusMark, 2026-11-18): new waits for review (amber), a
 *          classified report is settled and idle until someone sends a fix
 *          (grey: 897 amber "Classified" rows read as 897 warnings, R2 sweep
 *          2026-11-18), fixing runs, fixed and verified pass, reopened fails, dismissed
 *          is cancelled. Used by the Bugs table and the report preview.
 */

import type { RunStatus } from '../signal/StatusMark'

const REPORT_STATUS: Record<string, RunStatus> = {
  new: 'waiting',
  submitted: 'waiting',
  pending: 'waiting',
  queued: 'waiting',
  classified: 'idle',
  triaged: 'idle',
  grouped: 'idle',
  dispatched: 'running',
  fixing: 'running',
  fixed: 'passed',
  verified: 'passed',
  resolved: 'passed',
  completed: 'passed',
  reopened: 'failed',
  dismissed: 'cancelled',
}

export function reportRunStatus(status: string | null | undefined): RunStatus {
  return (status && REPORT_STATUS[status]) || 'idle'
}
