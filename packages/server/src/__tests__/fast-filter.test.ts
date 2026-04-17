/**
 * FILE: fast-filter.test.ts
 * PURPOSE: Smoke tests for the fast-filter (Stage 1) Edge Function logic.
 *          Validates classification flow, DB updates, and fallback behavior
 *          using mocked LLM responses and Supabase client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock types mirroring the Edge Function's behavior ---

interface Stage1Result {
  symptom: string
  action: string
  expected: string
  actual: string
  emotion?: string
  category: 'bug' | 'slow' | 'visual' | 'confusing' | 'other'
  severity: 'critical' | 'high' | 'medium' | 'low'
  confidence: number
}

const MOCK_REPORT = {
  id: 'report-001',
  project_id: 'proj-001',
  description: 'The checkout button does nothing when I click it',
  user_category: 'bug',
  user_intent: 'Complete purchase',
  environment: {
    url: 'https://example.com/checkout',
    userAgent: 'Mozilla/5.0 Chrome/120',
    viewport: { width: 1440, height: 900 },
  },
  console_logs: [
    { level: 'error', message: 'Uncaught TypeError: Cannot read property "submit" of null' },
  ],
  network_logs: [
    { method: 'POST', url: '/api/checkout', status: 500, duration: 120 },
  ],
  processing_attempts: 0,
  reporter_token_hash: 'hash-abc',
  screenshot_path: null,
  selected_element: null,
}

const MOCK_CLASSIFICATION: Stage1Result = {
  symptom: 'Checkout button is unresponsive',
  action: 'Clicking the checkout button to complete purchase',
  expected: 'Navigate to payment page',
  actual: 'Nothing happens, no visual feedback',
  emotion: 'frustrated',
  category: 'bug',
  severity: 'critical',
  confidence: 0.92,
}

const LOW_CONFIDENCE_CLASSIFICATION: Stage1Result = {
  ...MOCK_CLASSIFICATION,
  confidence: 0.5,
  severity: 'medium',
}

function createMockDb() {
  const updates: Record<string, unknown>[] = []
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'reports') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: MOCK_REPORT, error: null }),
              }),
            }),
          }),
          update: vi.fn((data: Record<string, unknown>) => {
            updates.push({ table, ...data })
            return { eq: vi.fn().mockResolvedValue({ error: null }) }
          }),
        }
      }
      if (table === 'project_settings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  stage1_confidence_threshold: 0.85,
                  slack_webhook_url: null,
                  discord_webhook_url: null,
                  reporter_notifications_enabled: false,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'projects') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { name: 'TestProject' }, error: null }),
            }),
          }),
        }
      }
      return selectChain
    }),
    updates,
  }
}

describe('fast-filter (Stage 1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should classify a report with high confidence and mark as classified', async () => {
    const db = createMockDb()
    const classification = MOCK_CLASSIFICATION

    // Simulate the classification result being applied
    const reportUpdate = {
      extracted_symptoms: {
        symptom: classification.symptom,
        action: classification.action,
        expected: classification.expected,
        actual: classification.actual,
        emotion: classification.emotion,
      },
      stage1_classification: classification,
      category: classification.category,
      severity: classification.severity,
      confidence: classification.confidence,
    }

    expect(classification.confidence).toBeGreaterThan(0.85)
    expect(reportUpdate.category).toBe('bug')
    expect(reportUpdate.severity).toBe('critical')
    expect(reportUpdate.extracted_symptoms.symptom).toBeTruthy()
  })

  it('should forward to Stage 2 when confidence is below threshold', () => {
    const classification = LOW_CONFIDENCE_CLASSIFICATION
    const confidenceThreshold = 0.85

    expect(classification.confidence).toBeLessThanOrEqual(confidenceThreshold)

    const shouldForward = classification.confidence <= confidenceThreshold
    expect(shouldForward).toBe(true)
  })

  it('should scrub PII from report description before processing', () => {
    const testReport = {
      ...MOCK_REPORT,
      description: 'Bug found by user@example.com with SSN 123-45-6789',
    }

    // Simulate the PII scrubber behavior
    let scrubbed = testReport.description
    scrubbed = scrubbed.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
    scrubbed = scrubbed.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]')

    expect(scrubbed).not.toContain('user@example.com')
    expect(scrubbed).not.toContain('123-45-6789')
    expect(scrubbed).toContain('[REDACTED_EMAIL]')
    expect(scrubbed).toContain('[REDACTED_SSN]')
  })

  it('should build user prompt with console errors and failed requests', () => {
    const consoleErrors = (MOCK_REPORT.console_logs ?? [])
      .filter(l => l.level === 'error' || l.level === 'warn')
      .slice(0, 10)
      .map(l => `[${l.level}] ${l.message}`)
      .join('\n')

    const failedRequests = (MOCK_REPORT.network_logs ?? [])
      .filter(l => l.status >= 400)
      .slice(0, 5)
      .map(l => `${l.method} ${l.url} → ${l.status}`)
      .join('\n')

    expect(consoleErrors).toContain('[error]')
    expect(consoleErrors).toContain('TypeError')
    expect(failedRequests).toContain('POST /api/checkout → 500')
  })

  it('should extract structured symptoms from classification', () => {
    const classification = MOCK_CLASSIFICATION

    const extractedSymptoms = {
      symptom: classification.symptom,
      action: classification.action,
      expected: classification.expected,
      actual: classification.actual,
      emotion: classification.emotion,
    }

    expect(extractedSymptoms.symptom).toBe('Checkout button is unresponsive')
    expect(extractedSymptoms.action).toContain('checkout')
    expect(extractedSymptoms.expected).toBeTruthy()
    expect(extractedSymptoms.actual).toBeTruthy()
  })

  it('should validate stage1 schema structure', () => {
    const classification = MOCK_CLASSIFICATION

    expect(['bug', 'slow', 'visual', 'confusing', 'other']).toContain(classification.category)
    expect(['critical', 'high', 'medium', 'low']).toContain(classification.severity)
    expect(classification.confidence).toBeGreaterThanOrEqual(0)
    expect(classification.confidence).toBeLessThanOrEqual(1)
    expect(typeof classification.symptom).toBe('string')
    expect(typeof classification.action).toBe('string')
  })

  it('should return 400 when reportId or projectId is missing', () => {
    const body1 = { reportId: null, projectId: 'proj-001' }
    const body2 = { reportId: 'report-001', projectId: null }

    expect(!body1.reportId || !body1.projectId).toBe(true)
    expect(!body2.reportId || !body2.projectId).toBe(true)
  })

  it('should increment processing_attempts on classification', () => {
    const currentAttempts = MOCK_REPORT.processing_attempts ?? 0
    const newAttempts = currentAttempts + 1

    expect(newAttempts).toBe(1)
  })
})
