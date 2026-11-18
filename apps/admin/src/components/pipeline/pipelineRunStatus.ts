/**
 * FILE: apps/admin/src/components/pipeline/pipelineRunStatus.ts
 * PURPOSE: The Pipeline page's machine, lane, run and train states as the
 *          console's one status system (StatusMark, 2026-11-18; the owner: "a
 *          running runner could show as running colour and status and
 *          graphical, and show different when broken"). A working lane pulses
 *          blue, an offline machine is a red ✕, a run that opened a PR is ✓.
 */

import type { RunStatus } from '../signal/StatusMark'

/** A worker lane's state word (lane.status.state, or paused/draining from its settings). */
export function laneRunStatus(state: string): RunStatus {
  switch (state) {
    case 'working':
    case 'running':
      return 'running'
    case 'paused':
    case 'starting':
      return 'waiting'
    case 'draining':
      return 'slow'
    case 'idle':
      return 'idle'
    case 'offline':
    case 'error':
    case 'failed':
    case 'out_of_usage':
    case 'signed_out':
      return 'failed'
    default:
      return 'idle'
  }
}

/** How one lane run ended (OUTCOME_LABEL in lib/workers.ts). A machine failure is slow, not the code's fault. */
export function runOutcomeStatus(outcome: string | null | undefined, failureKind?: string | null): RunStatus {
  if (outcome === 'pr_opened' || outcome === 'pushed' || outcome === 'filed' || outcome === 'gone') return 'passed'
  if (failureKind === 'infra' || outcome === 'lease_expired' || outcome === 'timeout') return 'slow'
  if (outcome === 'failed' || outcome === 'refused') return 'failed'
  if (outcome === 'stopped') return 'cancelled'
  return 'idle'
}

/** A machine: online passes, offline is broken, revoked is struck. */
export function hostRunStatus(host: { revoked?: boolean; online?: boolean }): RunStatus {
  if (host.revoked) return 'cancelled'
  return host.online ? 'passed' : 'failed'
}

/** A sign-in on a machine (Cursor account switch, gh): signed in passes, a pending step waits, the rest fail. */
export function signInRunStatus(state: string): RunStatus {
  if (state === 'signed_in' || state === 'done') return 'passed'
  if (state === 'link_ready' || state === 'requested' || state === 'waiting_for_runs') return 'waiting'
  if (state === 'unknown') return 'idle'
  return 'failed'
}
