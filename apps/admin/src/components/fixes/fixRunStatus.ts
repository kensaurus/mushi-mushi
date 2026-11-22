/**
 * FILE: apps/admin/src/components/fixes/fixRunStatus.ts
 * PURPOSE: Fix, dispatch and CI states as the console's one status system
 *          (StatusMark, 2026-11-18): running pulses blue, passed is a green
 *          ✓, failed a red ✕, waiting an amber clock, skipped grey ○,
 *          cancelled struck grey. Shared by the Fixes rows, the in-flight
 *          dispatches and the Pipeline page.
 */

import type { RunStatus } from '../signal/StatusMark'
import { ciBadge, type FixAttempt } from './types'

const FIX_STATUS: Record<string, RunStatus> = {
  pending: 'waiting',
  queued: 'waiting',
  dispatched: 'waiting',
  running: 'running',
  exporting: 'running',
  training: 'running',
  validating: 'running',
  exported: 'passed',
  trained: 'passed',
  validated: 'passed',
  promoted: 'passed',
  completed: 'passed',
  merged: 'passed',
  failed: 'failed',
  error: 'failed',
  dead_letter: 'failed',
  rejected: 'failed',
  cancelled: 'cancelled',
  // A dispatch that finished without opening a PR did not deliver the fix.
  completed_no_pr: 'slow',
}

/** A fix attempt's or a dispatch job's status as a mark. */
export function fixRunStatus(status: string | null | undefined): RunStatus {
  if (!status) return 'idle'
  if (status.startsWith('skipped')) return 'idle'
  return FIX_STATUS[status] ?? 'idle'
}

const CHECK_RUN_STATUS: Record<string, RunStatus> = {
  success: 'passed',
  failure: 'failed',
  timed_out: 'failed',
  startup_failure: 'failed',
  cancelled: 'cancelled',
  action_required: 'waiting',
  neutral: 'idle',
  skipped: 'idle',
  stale: 'idle',
  in_progress: 'running',
  queued: 'waiting',
  pending: 'waiting',
  requested: 'waiting',
  waiting: 'waiting',
}

/**
 * The fix's CI run as a mark plus the row's words, or null when GitHub has
 * not reported yet. A run whose machine never came is "not tested": waiting,
 * never passed or failed (ADR 0033).
 */
export function ciRunStatus(fix: FixAttempt): { label: string; status: RunStatus } | null {
  const badge = ciBadge(fix)
  if (!badge) return null
  if (fix.ci_infra?.infra) return { label: badge.label, status: 'waiting' }
  const key = (fix.check_run_conclusion ?? fix.check_run_status ?? '').toLowerCase()
  return { label: badge.label, status: CHECK_RUN_STATUS[key] ?? 'idle' }
}
