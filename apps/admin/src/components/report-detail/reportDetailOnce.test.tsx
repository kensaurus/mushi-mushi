/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/reportDetailOnce.test.tsx
 * PURPOSE: Fresh-eyes sweep 2026-11-18 on a Sentry import (/reports/:id):
 *   - one summary sentence showed five times; it shows once (summaryPlace);
 *   - four evidence cards each held a dashed "nothing captured" box; they are
 *     one "Not captured" line (missingCaptures);
 *   - "Reporter view" and "Ask reporter" showed with no reporter, and the
 *     intake name "sentry-webhook" sat under "Reporter token hash";
 *   - a 0 × 0 viewport read as a measurement;
 *   - the LLM classification card held boxes inside the card.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { summaryPlace } from './summaryPlace'
import { missingCaptures } from './reportCaptureHints'
import { isReporterKeyHash, reportHasReporter } from './reporterPresence'
import { ClassificationFields } from './ReportClassification'
import { EnvironmentFields } from './ReportEvidence'
import type { ReportDetail } from './types'

const base = {
  id: 'r1',
  project_id: 'p1',
  category: 'bug',
  severity: 'medium',
  summary: 'The retention sweep failed while reading projects',
  confidence: 0.97,
  stage1_classification: { category: 'bug' },
  stage2_analysis: null,
  processing_error: null,
  performance_metrics: null,
  console_logs: null,
  network_logs: null,
  repro_timeline: null,
} as unknown as ReportDetail
const r = (over: Partial<ReportDetail> = {}) => ({ ...base, ...over }) as ReportDetail

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('summaryPlace', () => {
  it('puts the summary in the heading without a title, else in the diagnosis card, else in the classification card', () => {
    expect(summaryPlace(r())).toBe('hero')
    expect(summaryPlace(r({ title: 'Retention sweep broke' }))).toBe('diagnosis')
    expect(summaryPlace(r({ title: 'Retention sweep broke', stage2_analysis: { rootCause: 'Ambiguous embed' } }))).toBe('classification')
  })

  it('the classification card shows the summary only when it is the one place', () => {
    act(() => root.render(createElement(ClassificationFields, { report: r() })))
    expect(container.querySelector('[data-testid="classification-summary"]')).toBeNull()
    act(() => root.render(createElement(ClassificationFields, { report: r({ title: 'T', stage2_analysis: { rootCause: 'Ambiguous embed' } }) })))
    expect(container.querySelector('[data-testid="classification-summary"]')?.textContent).toContain('The retention sweep failed')
  })

  it('draws the classification as plain rows, not boxes in the card', () => {
    act(() => root.render(createElement(ClassificationFields, { report: r({ component: 'retention-sweep' }) })))
    const rows = container.querySelector('[data-testid="classification-rows"]')!
    expect(rows.tagName).toBe('DL')
    expect(Array.from(rows.querySelectorAll('dt')).map((d) => d.textContent)).toEqual(['Category', 'Severity', 'Confidence', 'Component'])
  })
})

describe('missingCaptures', () => {
  it('lists every empty evidence panel, and none that has data', () => {
    // The screenshot, session ID and breadcrumbs notes joined the same line (R2 sweep 2026-11-18).
    expect(missingCaptures(r())).toEqual(['vitals', 'console', 'network', 'repro', 'screenshot', 'session', 'breadcrumbs'])
    expect(
      missingCaptures(
        r({
          performance_metrics: { lcp: 1200 },
          console_logs: [{ level: 'error', message: 'x', timestamp: 1 }],
          repro_timeline: [{ kind: 'route', ts: 1 }] as unknown as ReportDetail['repro_timeline'],
        }),
      ),
    ).toEqual(['network', 'screenshot', 'session', 'breadcrumbs'])
    expect(
      missingCaptures(
        r({
          screenshot_url: 'https://x/s.png',
          session_id: 's1',
          custom_metadata: { sentry: { breadcrumbs: [{ message: 'x' }] } } as unknown as ReportDetail['custom_metadata'],
        }),
      ),
    ).toEqual(['vitals', 'console', 'network', 'repro'])
    // Backend spans keep the Network card (its trace waterfall).
    expect(missingCaptures(r({ backend_spans: [{}] as unknown as ReportDetail['backend_spans'] }))).not.toContain('network')
  })
})

describe('reporter presence', () => {
  it('has a reporter for a user report or a test, not for Sentry, alarms or checks', () => {
    expect(reportHasReporter(r({ source: null } as Partial<ReportDetail>))).toBe(true)
    expect(reportHasReporter(r({ source: 'sentry' } as Partial<ReportDetail>))).toBe(false)
    expect(reportHasReporter(r({ source: 'cloudwatch' } as Partial<ReportDetail>))).toBe(false)
    expect(reportHasReporter(r({ source: 'site_watch' } as Partial<ReportDetail>))).toBe(false)
    expect(reportHasReporter(r({ source: null, custom_metadata: { source: 'admin_test_report' } } as Partial<ReportDetail>))).toBe(true)
  })

  it('tells a reporter key from an intake name', () => {
    expect(isReporterKeyHash(`rk1_${'a'.repeat(64)}`)).toBe(true)
    expect(isReporterKeyHash('b850e61a1d1c4b2e9a8e')).toBe(true)
    expect(isReporterKeyHash('sentry-webhook')).toBe(false)
    expect(isReporterKeyHash('cron:library')).toBe(false)
  })
})

describe('EnvironmentFields viewport', () => {
  it('says "not captured" for a 0 × 0 viewport, and shows a real one', () => {
    act(() => root.render(createElement(EnvironmentFields, { environment: { viewport: { width: 0, height: 0 } } as ReportDetail['environment'], sessionId: null })))
    expect(container.querySelector('[data-testid="env-viewport-missing"]')?.textContent).toBe('not captured')
    act(() => root.render(createElement(EnvironmentFields, { environment: { viewport: { width: 1440, height: 900 } } as ReportDetail['environment'], sessionId: null })))
    expect(container.querySelector('[data-testid="env-viewport-missing"]')).toBeNull()
    expect(container.textContent).toContain('1,440')
  })
})
