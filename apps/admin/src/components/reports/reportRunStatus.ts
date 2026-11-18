/**
 * FILE: apps/admin/src/components/reports/reportRunStatus.ts
 * PURPOSE: A report's lifecycle state as the console's status mark
 *          (StatusMark, 2026-11-18): new and classified wait for a fix,
 *          fixing runs, fixed and verified pass, reopened fails, dismissed
 *          is cancelled. Used by the Bugs table and the report preview.
 */

import type { RunStatus } from '../signal/StatusMark'

const REPORT_STATUS: Record<string, RunStatus> = {
  new: 'waiting',
  submitted: 'waiting',
  pending: 'waiting',
  queued: 'waiting',
  classified: 'waiting',
  triaged: 'waiting',
  grouped: 'waiting',
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
