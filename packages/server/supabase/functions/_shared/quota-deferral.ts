/**
 * FILE: _shared/quota-deferral.ts
 * PURPOSE: One failed diagnosis-quota read is one Sentry issue, not three.
 *
 * When checkDiagnosisQuota cannot read the plan or the usage count it answers
 * QUOTA_CHECK_UNAVAILABLE and logs the cause as an error (the one signal worth
 * paging on). classify-report then defers the report for the recovery cron.
 * On 2026-11-17 that deferral also surfaced as classify-report "Unhandled
 * error" (500) and as fast-filter "Stage 2 returned non-2xx", and the Sentry
 * intake filed all three as reports (MUSHI-MUSHI-SERVER-40, -41, -42; Mushi
 * reports 593bc8e7, 3a5cb64c, 76afb362) for a single cause.
 *
 * Now classify-report answers 503 with this code and a warn, and fast-filter
 * warns on that answer. The report keeps its processing_error, so the
 * recovery cron retries it exactly as before.
 */

export const QUOTA_CHECK_UNAVAILABLE = 'QUOTA_CHECK_UNAVAILABLE' as const

/** classify-report throws this when the quota check answered QUOTA_CHECK_UNAVAILABLE. */
export class QuotaCheckUnavailableError extends Error {
  readonly code = QUOTA_CHECK_UNAVAILABLE

  constructor() {
    super('Diagnosis quota check unavailable (transient DB error) — deferring classification for retry')
    this.name = 'QuotaCheckUnavailableError'
  }
}

/** classify-report's answer for a deferred report. */
export function quotaDeferralBody(err: QuotaCheckUnavailableError): string {
  return JSON.stringify({ ok: false, error: { code: QUOTA_CHECK_UNAVAILABLE, message: err.message } })
}

/** True when a classify-report answer is that retryable deferral, not a failure. */
export function isQuotaCheckDeferral(status: number, body: string): boolean {
  return status === 503 && body.includes(QUOTA_CHECK_UNAVAILABLE)
}
