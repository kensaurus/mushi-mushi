/**
 * FILE: apps/admin/src/lib/firstDiagnosis.ts
 * PURPOSE: Pure state machine behind the "See your first diagnosis" screen
 *          (onboarding S2 + the Overview / Reports empty states).
 *
 *          Send a test report → poll `GET /v1/admin/reports/:id` every 2 s
 *          (max 90 s) → render the classification inline. Every transition
 *          is a pure reducer so the polling states (queued / classifying /
 *          quota exhausted / classifier failed / offline / timed out) can be
 *          unit-tested without React or fetch.
 *
 *          The React side (`components/onboarding/FirstDiagnosisScreen.tsx`)
 *          owns timers and network; this file owns the decisions.
 */

export const FIRST_DIAGNOSIS_POLL_INTERVAL_MS = 2_000
export const FIRST_DIAGNOSIS_POLL_TIMEOUT_MS = 90_000

/** Subset of `ReportDetail` the poller reads. Kept loose on purpose — the
 *  row is polled while the classifier is still writing to it. */
export interface PolledReport {
  id: string
  status?: string | null
  category?: string | null
  severity?: string | null
  summary?: string | null
  title?: string | null
  processing_error?: string | null
  classified_at?: string | null
  stage1_classification?: Record<string, unknown> | null
  stage2_analysis?: Record<string, unknown> | null
}

export interface Diagnosis {
  reportId: string
  title: string
  severity: string | null
  category: string | null
  summary: string | null
  rootCause: string | null
}

export type ReportReading =
  | { kind: 'queued' }
  | { kind: 'classifying' }
  | { kind: 'diagnosed'; diagnosis: Diagnosis }
  | { kind: 'quota_exhausted'; message: string }
  | { kind: 'classifier_failed'; message: string }

const QUOTA_MESSAGE = 'Diagnosis quota reached for this project — upgrade in Billing to keep classifying.'
const FAILED_MESSAGE = 'The classifier hit an error on this report.'

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function readRootCause(stage2: Record<string, unknown> | null | undefined): string | null {
  if (!stage2) return null
  for (const key of ['rootCause', 'root_cause', 'root_cause_hypothesis']) {
    const value = stage2[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function toDiagnosis(report: PolledReport): Diagnosis {
  const summary = nonEmpty(report.summary)
  return {
    reportId: report.id,
    title: nonEmpty(report.title) ?? summary ?? 'Diagnosis ready',
    severity: nonEmpty(report.severity),
    category: nonEmpty(report.category),
    summary,
    rootCause: readRootCause(report.stage2_analysis),
  }
}

/** Classify a polled row into what the screen should say. */
export function readReport(report: PolledReport): ReportReading {
  if (report.status === 'quota_exceeded') {
    return { kind: 'quota_exhausted', message: QUOTA_MESSAGE }
  }
  const hasStage2 = report.stage2_analysis != null && typeof report.stage2_analysis === 'object'
  const diagnosed = Boolean(nonEmpty(report.summary)) || hasStage2 || Boolean(nonEmpty(report.severity))
  if (diagnosed) {
    return { kind: 'diagnosed', diagnosis: toDiagnosis(report) }
  }
  if (report.status === 'error' || report.status === 'failed') {
    return { kind: 'classifier_failed', message: nonEmpty(report.processing_error) ?? FAILED_MESSAGE }
  }
  if (nonEmpty(report.processing_error)) {
    return { kind: 'classifier_failed', message: report.processing_error!.trim() }
  }
  if (report.stage1_classification != null) {
    return { kind: 'classifying' }
  }
  return { kind: 'queued' }
}

// ─── State machine ───────────────────────────────────────────────────────────

type PollingPhase = 'queued' | 'classifying'

export type FirstDiagnosisState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'queued'; reportId: string; startedAt: number; polls: number }
  | { phase: 'classifying'; reportId: string; startedAt: number; polls: number }
  | { phase: 'diagnosed'; reportId: string; diagnosis: Diagnosis }
  | { phase: 'quota_exhausted'; reportId: string | null; message: string }
  | { phase: 'classifier_failed'; reportId: string | null; message: string }
  | { phase: 'offline'; reportId: string | null; resume: PollingPhase | null }
  | { phase: 'timed_out'; reportId: string }
  | { phase: 'send_failed'; code: string; message: string }

export type FirstDiagnosisEvent =
  | { type: 'send' }
  | { type: 'send_ok'; reportId: string; at: number }
  | { type: 'send_failed'; code: string; message: string }
  | { type: 'poll_ok'; report: PolledReport; at: number }
  | { type: 'poll_failed'; code: string; message: string; at: number }
  | { type: 'went_offline' }
  | { type: 'back_online'; at: number }
  | { type: 'keep_waiting'; at: number }
  | { type: 'reset' }

export const FIRST_DIAGNOSIS_INITIAL: FirstDiagnosisState = { phase: 'idle' }

const QUOTA_CODES = new Set([
  'QUOTA_EXCEEDED',
  'SPEND_CAP_REACHED',
  'DIAGNOSIS_QUOTA',
  'feature_not_in_plan',
  'PLAN_LIMIT',
  'REPORT_QUOTA_EXCEEDED',
])

const OFFLINE_CODES = new Set(['NETWORK_ERROR', 'OFFLINE', 'FETCH_FAILED'])

export function isQuotaCode(code: string | null | undefined): boolean {
  if (!code) return false
  if (QUOTA_CODES.has(code)) return true
  return /quota|spend_cap|plan_limit/i.test(code)
}

export function isOfflineCode(code: string | null | undefined): boolean {
  if (!code) return false
  return OFFLINE_CODES.has(code) || /network|offline|failed to fetch/i.test(code)
}

export function isPolling(state: FirstDiagnosisState): state is Extract<FirstDiagnosisState, { phase: PollingPhase }> {
  return state.phase === 'queued' || state.phase === 'classifying'
}

/** Report id the screen is currently tracking, if any. */
export function trackedReportId(state: FirstDiagnosisState): string | null {
  return 'reportId' in state ? state.reportId : null
}

export function reduceFirstDiagnosis(
  state: FirstDiagnosisState,
  event: FirstDiagnosisEvent,
): FirstDiagnosisState {
  switch (event.type) {
    case 'send':
      return { phase: 'sending' }

    case 'send_ok':
      if (state.phase !== 'sending') return state
      return { phase: 'queued', reportId: event.reportId, startedAt: event.at, polls: 0 }

    case 'send_failed':
      if (state.phase !== 'sending') return state
      if (isQuotaCode(event.code)) {
        return { phase: 'quota_exhausted', reportId: null, message: event.message }
      }
      if (isOfflineCode(event.code)) {
        return { phase: 'offline', reportId: null, resume: null }
      }
      return { phase: 'send_failed', code: event.code, message: event.message }

    case 'poll_ok': {
      if (!isPolling(state)) return state
      const reading = readReport(event.report)
      switch (reading.kind) {
        case 'diagnosed':
          return { phase: 'diagnosed', reportId: state.reportId, diagnosis: reading.diagnosis }
        case 'quota_exhausted':
          return { phase: 'quota_exhausted', reportId: state.reportId, message: reading.message }
        case 'classifier_failed':
          return { phase: 'classifier_failed', reportId: state.reportId, message: reading.message }
        case 'classifying':
        case 'queued': {
          if (event.at - state.startedAt >= FIRST_DIAGNOSIS_POLL_TIMEOUT_MS) {
            return { phase: 'timed_out', reportId: state.reportId }
          }
          return {
            phase: reading.kind,
            reportId: state.reportId,
            startedAt: state.startedAt,
            polls: state.polls + 1,
          }
        }
      }
      return state
    }

    case 'poll_failed': {
      if (!isPolling(state)) return state
      if (isOfflineCode(event.code)) {
        return { phase: 'offline', reportId: state.reportId, resume: state.phase }
      }
      if (isQuotaCode(event.code)) {
        return { phase: 'quota_exhausted', reportId: state.reportId, message: event.message }
      }
      if (event.at - state.startedAt >= FIRST_DIAGNOSIS_POLL_TIMEOUT_MS) {
        return { phase: 'timed_out', reportId: state.reportId }
      }
      // Transient server error — keep polling; the timeout bounds it.
      return { ...state, polls: state.polls + 1 }
    }

    case 'went_offline':
      if (isPolling(state)) {
        return { phase: 'offline', reportId: state.reportId, resume: state.phase }
      }
      if (state.phase === 'sending') {
        return { phase: 'offline', reportId: null, resume: null }
      }
      return state

    case 'back_online':
      if (state.phase !== 'offline') return state
      if (state.reportId && state.resume) {
        // Fresh 90 s budget — the outage should not eat the poll window.
        return { phase: state.resume, reportId: state.reportId, startedAt: event.at, polls: 0 }
      }
      return { phase: 'idle' }

    case 'keep_waiting':
      if (state.phase === 'timed_out') {
        return { phase: 'classifying', reportId: state.reportId, startedAt: event.at, polls: 0 }
      }
      if (state.phase === 'classifier_failed' && state.reportId) {
        return { phase: 'classifying', reportId: state.reportId, startedAt: event.at, polls: 0 }
      }
      return state

    case 'reset':
      return { phase: 'idle' }
  }
  return state
}

// ─── Copy ────────────────────────────────────────────────────────────────────

export interface PhaseCopy {
  headline: string
  detail: string
  tone: 'idle' | 'running' | 'success' | 'error' | 'info'
}

/** Human copy per phase. Pure so it can be asserted in tests. */
export function firstDiagnosisCopy(state: FirstDiagnosisState): PhaseCopy | null {
  switch (state.phase) {
    case 'idle':
      return null
    case 'sending':
      return { headline: 'Sending a test report…', detail: 'A realistic synthetic bug, the way a real user would file it.', tone: 'running' }
    case 'queued':
      return { headline: 'Queued', detail: 'The classifier picks it up within a few seconds.', tone: 'running' }
    case 'classifying':
      return { headline: 'Classifying', detail: 'Reading the screenshot, console, and network logs to write a plain-English diagnosis.', tone: 'running' }
    case 'diagnosed':
      return { headline: 'Diagnosis ready', detail: 'This is what your users will get, automatically, for every bug they file.', tone: 'success' }
    case 'quota_exhausted':
      return { headline: 'Diagnosis quota reached', detail: state.message, tone: 'error' }
    case 'classifier_failed':
      return { headline: 'Classifier failed', detail: state.message, tone: 'error' }
    case 'offline':
      return { headline: 'You are offline', detail: 'Polling resumes automatically when the connection is back.', tone: 'info' }
    case 'timed_out':
      return { headline: 'Still classifying', detail: 'Ninety seconds without a result. The report is safe — keep waiting or open it in Reports.', tone: 'info' }
    case 'send_failed':
      return { headline: 'Could not send the test report', detail: state.message, tone: 'error' }
  }
}
