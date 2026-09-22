/**
 * FILE: packages/server/src/__tests__/test-report-metering-contract.test.ts
 * PURPOSE: The console's one-click test report is metered like any other
 *          report: a per-user hourly claim and the plan's monthly quota, both
 *          checked before ingest.
 *
 * Why (2026-09-21): POST /v1/admin/projects/:id/test-report ran ingestReport
 * — and with it a real Stage-1 LLM call — with no quota check and no rate
 * claim, so the button bypassed both.
 *
 * Reads the route source verbatim (no Deno runtime), like the other
 * *-contract tests.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const routesDir = resolve(__dirname, '../../supabase/functions/api/routes')

describe('console test report metering', () => {
  const src = readFileSync(resolve(routesDir, 'project-integrations.ts'), 'utf-8')
  const start = src.indexOf("app.post('/v1/admin/projects/:id/test-report'")
  const handler = src.slice(start)
  const ingestAt = handler.indexOf('ingestReport(')

  it('finds the handler', () => {
    expect(start).toBeGreaterThan(-1)
    expect(ingestAt).toBeGreaterThan(-1)
  })

  it('claims a per-user hourly slot before ingest', () => {
    const claimAt = handler.indexOf("'scoped_rate_limit_claim'")
    expect(claimAt).toBeGreaterThan(-1)
    expect(claimAt).toBeLessThan(ingestAt)
    expect(handler.slice(claimAt, ingestAt)).toContain("p_scope: 'test_report'")
  })

  it('checks the monthly report quota before ingest', () => {
    const quotaAt = handler.indexOf('checkIngestQuota(')
    expect(quotaAt).toBeGreaterThan(-1)
    expect(quotaAt).toBeLessThan(ingestAt)
  })
})
