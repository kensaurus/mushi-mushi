/**
 * FILE: quota-deferral.test.ts
 * PURPOSE: One failed diagnosis-quota read stays one Sentry issue.
 *
 * On 2026-11-17 an ambiguous `projects` → `organizations` embed made every
 * quota read fail. checkDiagnosisQuota logged it (MUSHI-MUSHI-SERVER-42), and
 * the deferral it caused was logged twice more as errors: classify-report
 * "Unhandled error" (-40) and fast-filter "Stage 2 returned non-2xx" (-41).
 * The Sentry intake then filed three Mushi reports for one cause.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  QUOTA_CHECK_UNAVAILABLE,
  QuotaCheckUnavailableError,
  isQuotaCheckDeferral,
  quotaDeferralBody,
} from '../../supabase/functions/_shared/quota-deferral.ts'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('quota deferral answer', () => {
  it('round-trips: the body classify-report sends is recognised by fast-filter', () => {
    const body = quotaDeferralBody(new QuotaCheckUnavailableError())
    expect(JSON.parse(body)).toEqual({
      ok: false,
      error: { code: QUOTA_CHECK_UNAVAILABLE, message: expect.stringContaining('deferring classification') },
    })
    expect(isQuotaCheckDeferral(503, body)).toBe(true)
  })

  it('treats any other failure as a real failure', () => {
    const body = quotaDeferralBody(new QuotaCheckUnavailableError())
    expect(isQuotaCheckDeferral(500, body)).toBe(false)
    expect(isQuotaCheckDeferral(503, '{"ok":false,"error":{"code":"DB_ERROR"}}')).toBe(false)
    expect(isQuotaCheckDeferral(500, '{"error":"Internal error. The failure was logged for investigation."}')).toBe(false)
  })

  it('is an Error carrying the code', () => {
    const err = new QuotaCheckUnavailableError()
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe(QUOTA_CHECK_UNAVAILABLE)
  })
})

describe('wiring', () => {
  const classify = read('../../supabase/functions/classify-report/index.ts')
  const fastFilter = read('../../supabase/functions/fast-filter/index.ts')

  it('classify-report defers with the typed error, answers 503 and does not log it as an unhandled error', () => {
    expect(classify).toContain('throw new QuotaCheckUnavailableError()')
    const catchStart = classify.indexOf('const quotaDeferred = err instanceof QuotaCheckUnavailableError')
    expect(catchStart).toBeGreaterThan(-1)
    const tail = classify.slice(catchStart)
    // The error log sits in the else branch, after the warn for a deferral.
    expect(tail.indexOf("warn('Stage 2 deferred: diagnosis quota check unavailable")).toBeLessThan(
      tail.indexOf("error('Unhandled error'"),
    )
    expect(tail).toMatch(/quotaDeferralBody\(err\), \{\s*status: 503/)
  })

  it('fast-filter warns on the deferral before the non-2xx error branch and still stamps processing_error', () => {
    const deferral = fastFilter.indexOf('isQuotaCheckDeferral(stage2Res.status, detail)')
    const nonOk = fastFilter.indexOf("log.error('Stage 2 returned non-2xx'")
    expect(deferral).toBeGreaterThan(-1)
    expect(deferral).toBeLessThan(nonOk)
    const branch = fastFilter.slice(deferral, nonOk)
    expect(branch).toContain('log.warn(')
    expect(branch).toContain('stage2 handoff failed')
  })
})
