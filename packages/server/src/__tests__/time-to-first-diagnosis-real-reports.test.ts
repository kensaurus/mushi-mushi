/**
 * FILE: packages/server/src/__tests__/time-to-first-diagnosis-real-reports.test.ts
 * PURPOSE: The onboarding north-star "time to first diagnosis" must count the
 *          user's first REAL classified report.
 *
 * Why (2026-10-04, REPORT A2): the console's "Send test report" row now
 * carries a Stage-1 object so the report page stops reading it as pending.
 * The route keyed "first diagnosis" on `stage1_classification IS NOT NULL`
 * alone, so the synthetic report would have become everyone's first
 * diagnosis. It must skip non-real sources the way first_report_received does.
 *
 * Reads the route source verbatim (no Deno runtime), like the other
 * route-contract tests here.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const functionsDir = resolve(__dirname, '../../supabase/functions')

describe('time-to-first-diagnosis skips test and seed reports', () => {
  const src = readFileSync(resolve(functionsDir, 'api/routes/onboarding-setup.ts'), 'utf-8')
  const start = src.indexOf("'/v1/admin/onboarding/time-to-first-diagnosis'")
  const route = src.slice(start, src.indexOf('app.get(', start + 1))

  it('filters the classified reports with the shared non-real predicate', () => {
    expect(start).toBeGreaterThan(-1)
    expect(src).toContain("import { isNonRealReport } from '../../_shared/first-report.ts'")
    expect(route).toContain("select('created_at, custom_metadata')")
    expect(route).toMatch(/\.find\(\(row\) => !isNonRealReport\(row\.custom_metadata\)\)/)
    expect(route).not.toMatch(/\.limit\(1\)\s*\.maybeSingle\(\),\s*\]\);/)
  })

  it('the shared predicate covers the console test report and the marketing seed', () => {
    const shared = readFileSync(resolve(functionsDir, '_shared/first-report.ts'), 'utf-8')
    expect(shared).toContain("'admin_test_report'")
    expect(shared).toContain("'mushi-marketing-seed'")
  })
})
