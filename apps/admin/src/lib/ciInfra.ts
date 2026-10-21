/**
 * FILE: apps/admin/src/lib/ciInfra.ts
 * PURPOSE: One reading of a fix's CI for every fix-loop surface (ADR 0033):
 *          FixCiFeedback, FixProgressStream, the fix-attempt flow and the Act
 *          blocker. A test machine that stopped, a job no machine picked up,
 *          or one still waiting for a machine is NOT a code failure: it reads
 *          as a warning, "your fix was not tested", never danger.
 *
 * REGRESSION (glot.it 2026-10-21): an OOM-killed runner cancelled the job and
 * every surface said "CI failed" in red, so a follow-up agent tried to fix
 * code that never ran.
 */

import type { CiInfraVerdict } from './ciTypes'
import { formatSeconds } from './ciView'
import { CI_INFRA_WAITING_LABEL } from './fixReportTruth'

export interface CiSignals {
  check_run_conclusion?: string | null
  check_run_status?: string | null
  ci_infra?: CiInfraVerdict | null
}

export type CiState =
  | 'passed'
  | 'running'
  | 'waiting_for_runner'
  | 'runner_lost'
  | 'queue_expired'
  | 'cancelled'
  | 'code_failure'
  | 'timed_out'
  | 'neutral'
  | 'unknown'

export type CiTone = 'ok' | 'warn' | 'danger' | 'neutral'

export interface CiReading {
  state: CiState
  tone: CiTone
  /** Short chip text. */
  label: string
  /** One plain sentence: what happened and what it means for the fix. */
  detail: string
  /** True when the tests did not run to an answer because of the machine. */
  infra: boolean
  /** Re-running the tests is the next step. */
  canRerun: boolean
}

const CODE_FAIL = new Set(['failure', 'action_required'])

function machine(runner: string | null | undefined): string {
  return runner ? `the test machine (${runner})` : 'the test machine'
}

/** Read a fix's CI. An infra verdict wins over the raw check-run conclusion. */
export function readFixCi(fix: CiSignals): CiReading {
  const infra = fix.ci_infra?.infra ? fix.ci_infra : null
  if (infra) {
    if (infra.kind === 'waiting_for_runner') {
      const waited = infra.queuedSeconds != null ? ` for ${formatSeconds(infra.queuedSeconds)}` : ''
      return {
        state: 'waiting_for_runner',
        tone: 'warn',
        label: CI_INFRA_WAITING_LABEL,
        detail: `Waiting for a test machine${waited}. Your fix has not been tested yet.`,
        infra: true,
        canRerun: false,
      }
    }
    if (infra.kind === 'queue_expired') {
      return {
        state: 'queue_expired',
        tone: 'warn',
        label: 'Not tested',
        detail: 'No test machine picked this up, so GitHub cancelled it. Your fix was not tested.',
        infra: true,
        canRerun: true,
      }
    }
    // runner_lost, and any future infra kind the server adds.
    return {
      state: 'runner_lost',
      tone: 'warn',
      label: 'Not tested',
      detail: `Tests didn't finish: ${machine(infra.runner)} stopped. Your fix was not tested.`,
      infra: true,
      canRerun: true,
    }
  }

  const conclusion = fix.check_run_conclusion?.toLowerCase() ?? null
  const status = fix.check_run_status?.toLowerCase() ?? null
  if (status === 'in_progress' || status === 'queued') {
    return { state: 'running', tone: 'warn', label: 'CI running…', detail: 'Tests are running on GitHub.', infra: false, canRerun: false }
  }
  if (conclusion === 'success') {
    return { state: 'passed', tone: 'ok', label: 'CI passed', detail: 'All required checks passed.', infra: false, canRerun: false }
  }
  if (conclusion && CODE_FAIL.has(conclusion)) {
    return {
      state: 'code_failure',
      tone: 'danger',
      label: 'CI failed',
      detail: 'A check failed on your fix. Open the run log, fix the branch, then refresh here before merging.',
      infra: false,
      canRerun: false,
    }
  }
  if (conclusion === 'timed_out') {
    return {
      state: 'timed_out',
      tone: 'danger',
      label: 'CI timed out',
      detail: 'A check ran past its time limit. Open the run log to see which step hung.',
      infra: false,
      canRerun: true,
    }
  }
  if (conclusion === 'cancelled') {
    return {
      state: 'cancelled',
      tone: 'neutral',
      label: 'CI cancelled',
      detail: 'Cancelled (a newer push or a person stopped it).',
      infra: false,
      canRerun: true,
    }
  }
  if (conclusion === 'neutral' || conclusion === 'skipped') {
    return { state: 'neutral', tone: 'neutral', label: `CI ${conclusion}`, detail: 'GitHub skipped these checks.', infra: false, canRerun: false }
  }
  return {
    state: 'unknown',
    tone: 'neutral',
    label: 'CI status unknown',
    detail: 'Pull the latest check-run state from GitHub or open the PR checks tab.',
    infra: false,
    canRerun: false,
  }
}

/** Plain message for a failed `POST /v1/admin/fixes/:id/ci/rerun`. */
export function rerunErrorText(code: string | null | undefined, message: string | null | undefined): string {
  switch (code) {
    case 'CI_RUNNING':
      return 'Tests are still running on GitHub. Wait for them to finish, then re-run.'
    case 'GITHUB_ACTIONS_WRITE_MISSING':
      return "Mushi's GitHub access can't re-run tests. Give the GitHub token Actions: write, or re-run them from GitHub."
    case 'GITHUB_ACTIONS_READ_MISSING':
      return "Mushi's GitHub access can't read Actions runs. Give the GitHub token Actions: read and write."
    case 'RATE_LIMITED':
      return 'Tests can be re-run 6 times an hour per fix. Try again later, or re-run them from GitHub.'
    case 'NOTHING_TO_RERUN':
      return 'Nothing to re-run: no failed or cancelled run on the latest commit. Refresh CI status.'
    case 'NO_GITHUB_TOKEN':
      return 'Connect GitHub for this project first.'
  }
  return message?.trim() || 'Could not re-run the tests.'
}
