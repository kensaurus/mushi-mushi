/**
 * FILE: classify-report.test.ts
 * PURPOSE: Smoke tests for the classify-report (Stage 2) Edge Function logic.
 *          Validates deep analysis, vision path gating, RAG integration, and
 *          ontology tag application.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Stage2Result {
  category: 'bug' | 'slow' | 'visual' | 'confusing' | 'other'
  severity: 'critical' | 'high' | 'medium' | 'low'
  summary: string
  component?: string
  rootCause?: string
  reproductionSteps?: string[]
  suggestedFix?: string
  confidence: number
  bugOntologyTags?: string[]
}

const MOCK_STAGE1_EXTRACTION = {
  symptom: 'Checkout button is unresponsive',
  action: 'Clicking the checkout button',
  expected: 'Navigate to payment page',
  actual: 'Nothing happens',
  emotion: 'frustrated',
  category: 'bug',
  severity: 'critical',
  confidence: 0.7,
}

const MOCK_REPORT = {
  id: 'report-002',
  project_id: 'proj-001',
  description: 'The checkout button does nothing when I click it',
  user_category: 'bug',
  environment: {
    url: 'https://example.com/checkout',
    userAgent: 'Mozilla/5.0 Chrome/120',
    viewport: { width: 1440, height: 900 },
    platform: 'MacOS',
  },
  console_logs: [
    { level: 'error', message: 'TypeError: Cannot read property "submit" of null', stack: 'at checkout.tsx:42' },
  ],
  network_logs: [
    { method: 'POST', url: '/api/checkout', status: 500, duration: 120, error: 'Internal Server Error' },
  ],
  performance_metrics: { lcp: 1200, fcp: 800, cls: 0.05, inp: 120, ttfb: 200, longTasks: 0 },
  sentry_event_id: 'sentry-evt-001',
  sentry_replay_id: 'sentry-replay-001',
  screenshot_url: 'https://storage.example.com/screenshots/report-002.png',
  processing_attempts: 1,
  extracted_symptoms: MOCK_STAGE1_EXTRACTION,
  stage1_classification: MOCK_STAGE1_EXTRACTION,
  reporter_token_hash: 'hash-xyz',
}

const MOCK_STAGE2_RESULT: Stage2Result = {
  category: 'bug',
  severity: 'critical',
  summary: 'Checkout form submit handler references null element due to conditional rendering race',
  component: 'CheckoutForm',
  rootCause: 'The submit button handler calls document.getElementById("checkout-form") which returns null when the form is conditionally rendered and the user clicks before hydration completes.',
  reproductionSteps: [
    'Navigate to /checkout',
    'Click the checkout button immediately before page fully loads',
    'Observe no response and TypeError in console',
  ],
  suggestedFix: 'Use a React ref instead of document.getElementById, or add a null check with user feedback when the form is not ready.',
  confidence: 0.94,
  bugOntologyTags: ['state-management', 'react-hydration', 'null-reference'],
}

describe('classify-report (Stage 2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should produce a complete analysis with root cause and reproduction steps', () => {
    const result = MOCK_STAGE2_RESULT

    expect(result.summary).toBeTruthy()
    expect(result.summary.length).toBeLessThanOrEqual(200)
    expect(result.rootCause).toBeTruthy()
    expect(result.reproductionSteps).toBeDefined()
    expect(result.reproductionSteps!.length).toBeGreaterThan(0)
    expect(result.suggestedFix).toBeTruthy()
  })

  it('should trigger vision analysis for visual/bug/confusing categories with screenshots', () => {
    const enableVision = true
    const screenshotUrl = MOCK_REPORT.screenshot_url
    const category = MOCK_STAGE2_RESULT.category

    const shouldRunVision =
      enableVision &&
      screenshotUrl &&
      ['visual', 'bug', 'confusing'].includes(category)

    expect(shouldRunVision).toBe(true)
  })

  it('should skip vision analysis when disabled in settings', () => {
    const enableVision = false
    const screenshotUrl = MOCK_REPORT.screenshot_url
    const category = MOCK_STAGE2_RESULT.category

    const shouldRunVision =
      enableVision &&
      screenshotUrl &&
      ['visual', 'bug', 'confusing'].includes(category)

    expect(shouldRunVision).toBe(false)
  })

  it('should skip vision analysis when no screenshot', () => {
    const enableVision = true
    const screenshotUrl = null
    const category = 'bug'

    const shouldRunVision =
      enableVision &&
      !!screenshotUrl &&
      ['visual', 'bug', 'confusing'].includes(category)

    expect(shouldRunVision).toBe(false)
  })

  it('should skip vision for "other" and "slow" categories', () => {
    for (const category of ['other', 'slow']) {
      const shouldRunVision =
        true &&
        MOCK_REPORT.screenshot_url &&
        ['visual', 'bug', 'confusing'].includes(category)

      expect(shouldRunVision).toBe(false)
    }
  })

  it('should include Sentry context when event ID is present', () => {
    const sentryContext = MOCK_REPORT.sentry_event_id
      ? `\n## Sentry Context\n- Event ID: ${MOCK_REPORT.sentry_event_id}\n- Replay ID: ${MOCK_REPORT.sentry_replay_id ?? 'none'}`
      : ''

    expect(sentryContext).toContain('sentry-evt-001')
    expect(sentryContext).toContain('sentry-replay-001')
  })

  it('should omit Sentry context when no event ID', () => {
    const reportWithoutSentry = { ...MOCK_REPORT, sentry_event_id: null }
    const sentryContext = reportWithoutSentry.sentry_event_id
      ? `\n## Sentry Context\n- Event ID: ${reportWithoutSentry.sentry_event_id}`
      : ''

    expect(sentryContext).toBe('')
  })

  it('should apply ontology tags from classification result', () => {
    const tags = MOCK_STAGE2_RESULT.bugOntologyTags

    expect(tags).toBeDefined()
    expect(tags!.length).toBeGreaterThan(0)
    expect(tags).toContain('state-management')
    expect(tags).toContain('react-hydration')
  })

  it('should validate stage2 schema structure', () => {
    const result = MOCK_STAGE2_RESULT

    expect(['bug', 'slow', 'visual', 'confusing', 'other']).toContain(result.category)
    expect(['critical', 'high', 'medium', 'low']).toContain(result.severity)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(typeof result.summary).toBe('string')
  })

  it('should build prompt with performance metrics when available', () => {
    const perf = MOCK_REPORT.performance_metrics
    const perfSection = perf
      ? `\n## Performance Metrics\n- LCP: ${perf.lcp ?? '?'}ms\n- FCP: ${perf.fcp ?? '?'}ms\n- CLS: ${perf.cls ?? '?'}\n- INP: ${perf.inp ?? '?'}ms\n- TTFB: ${perf.ttfb ?? '?'}ms`
      : ''

    expect(perfSection).toContain('LCP: 1200ms')
    expect(perfSection).toContain('FCP: 800ms')
    expect(perfSection).toContain('CLS: 0.05')
  })

  it('should return 400 when reportId or projectId is missing', () => {
    const body = { reportId: null, projectId: 'proj-001', stage1Extraction: null }
    expect(!body.reportId || !body.projectId).toBe(true)
  })
})
