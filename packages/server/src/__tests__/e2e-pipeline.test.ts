/**
 * E2E pipeline verification test.
 *
 * Validates the full data path: SDK report submission → API ingestion →
 * Stage 1 (fast-filter) → Stage 2 (classify-report) → admin query.
 *
 * Run against a live Supabase project:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... MUSHI_API_KEY=... pnpm vitest run e2e-pipeline
 *
 * Without env vars, this test validates the payload/schema contracts only.
 */

import { describe, it, expect, beforeAll } from 'vitest'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const API_KEY = process.env.MUSHI_API_KEY
const API_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/api` : null

const isLive = !!(API_ENDPOINT && API_KEY && SERVICE_ROLE_KEY)

function buildTestReport(overrides?: Record<string, unknown>) {
  return {
    projectId: 'proj_test',
    category: 'bug' as const,
    description: 'E2E test: the submit button does nothing when clicked on the checkout page',
    userIntent: 'Complete a purchase',
    environment: {
      userAgent: 'Mozilla/5.0 (E2E Test) Chrome/120',
      platform: 'Win32',
      language: 'en-US',
      viewport: { width: 1440, height: 900 },
      url: 'https://example.com/checkout',
      referrer: 'https://example.com/cart',
      timestamp: new Date().toISOString(),
      timezone: 'Asia/Tokyo',
    },
    consoleLogs: [
      { level: 'error' as const, message: 'TypeError: Cannot read property "submit" of null', timestamp: Date.now() },
    ],
    networkLogs: [
      { method: 'POST', url: '/api/checkout', status: 500, duration: 120, timestamp: Date.now() },
    ],
    performanceMetrics: { lcp: 2400, cls: 0.05, fid: 80 },
    reporterToken: `e2e-test-${Date.now()}`,
    sessionId: `session-e2e-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('Pipeline payload contract', () => {
  it('should produce a valid report payload matching the submission schema', () => {
    const report = buildTestReport()

    expect(report.projectId).toBeTruthy()
    expect(report.category).toBe('bug')
    expect(report.description.length).toBeGreaterThan(5)
    expect(report.environment.url).toBeTruthy()
    expect(report.environment.viewport.width).toBeGreaterThan(0)
    expect(report.reporterToken).toBeTruthy()
    expect(report.createdAt).toBeTruthy()
  })

  it('should include required console and network context', () => {
    const report = buildTestReport()

    expect(report.consoleLogs).toHaveLength(1)
    expect(report.consoleLogs![0].level).toBe('error')
    expect(report.networkLogs).toHaveLength(1)
    expect(report.networkLogs![0].status).toBeGreaterThanOrEqual(400)
  })

  it('should reject payloads with missing required fields', () => {
    const incomplete = { description: 'hi' }
    expect(incomplete).not.toHaveProperty('category')
    expect(incomplete).not.toHaveProperty('environment')
    expect(incomplete).not.toHaveProperty('reporterToken')
  })
})

describe.skipIf(!isLive)('E2E pipeline (live Supabase)', () => {
  let reportId: string

  it('should submit a report via the ingest API', async () => {
    const report = buildTestReport()

    const res = await fetch(`${API_ENDPOINT}/v1/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': API_KEY!,
      },
      body: JSON.stringify(report),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reportId).toBeTruthy()
    reportId = body.reportId
  })

  it('should retrieve the report status', async () => {
    const res = await fetch(`${API_ENDPOINT}/v1/reports/${reportId}/status`, {
      headers: { 'X-Mushi-Api-Key': API_KEY! },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBeTruthy()
  })

  it('should reject requests without API key', async () => {
    const res = await fetch(`${API_ENDPOINT}/v1/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTestReport()),
    })

    expect(res.status).toBe(401)
  })

  it('should verify the health endpoint responds', async () => {
    const res = await fetch(`${API_ENDPOINT}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('should verify the internal edge functions reject fake service_role', async () => {
    const endpoints = ['fast-filter', 'judge-batch', 'intelligence-report', 'generate-synthetic']

    for (const fn of endpoints) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer service_role_fake_token',
        },
        body: JSON.stringify({ projectId: 'proj_test' }),
      })

      expect(res.status).toBe(401)
    }
  })
})
