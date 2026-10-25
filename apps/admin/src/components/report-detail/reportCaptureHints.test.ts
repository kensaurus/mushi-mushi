/**
 * FILE: apps/admin/src/components/report-detail/reportCaptureHints.test.ts
 * PURPOSE: Empty capture streams on a report collapse to one line instead of
 *          four blank cards.
 */

import { describe, expect, it } from 'vitest'
import { capturedEvidence, uncapturedEvidenceNote } from './reportCaptureHints'
import type { ReportDetail } from './types'

function report(
  overrides: Partial<
    Pick<ReportDetail, 'performance_metrics' | 'console_logs' | 'network_logs' | 'repro_timeline' | 'backend_spans'>
  >,
): Pick<ReportDetail, 'performance_metrics' | 'console_logs' | 'network_logs' | 'repro_timeline'> & {
  backend_spans?: ReportDetail['backend_spans']
} {
  return {
    performance_metrics: null,
    console_logs: null,
    network_logs: null,
    repro_timeline: null,
    ...overrides,
  }
}

describe('capturedEvidence', () => {
  it('treats a quiet report as nothing captured', () => {
    const flags = capturedEvidence(report({}))
    expect(flags).toEqual({ performance: false, console: false, network: false, repro: false })
    expect(uncapturedEvidenceNote(flags)).toBe(
      'Not captured: console logs, network, performance, and repro timeline.',
    )
  })

  it('shows a panel when that stream has rows, including spans without network logs', () => {
    const flags = capturedEvidence(
      report({
        console_logs: [{ level: 'error', message: 'boom', timestamp: 1 }],
        backend_spans: [
          { id: '1', trace_id: 't', session_id: null, span_json: { name: 'GET /x' }, ingested_at: '2026-01-01T00:00:00Z' },
        ],
      }),
    )
    expect(flags.console).toBe(true)
    expect(flags.network).toBe(true)
    expect(flags.performance).toBe(false)
    expect(uncapturedEvidenceNote(flags)).toBe('Not captured: performance and repro timeline.')
  })

  it('says nothing when every stream has data', () => {
    const flags = capturedEvidence(
      report({
        performance_metrics: { LCP: 100 },
        console_logs: [{ level: 'log', message: 'ok', timestamp: 1 }],
        network_logs: [{ method: 'GET', url: '/', status: 200, duration: 1, timestamp: 1 }],
        repro_timeline: [{ ts: 1, kind: 'log', payload: { message: 'hi' } }],
      }),
    )
    expect(uncapturedEvidenceNote(flags)).toBeNull()
  })
})
