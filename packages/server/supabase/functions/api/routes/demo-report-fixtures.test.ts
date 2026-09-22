import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  DEFAULT_TEST_REPORT_FIXTURE_ID,
  DEMO_REPORT_FIXTURES,
  getDemoReportFixture,
  materializeDemoReport,
  precomputedClassification,
} from '../../_shared/demo-report-fixtures.ts'
import { reportSubmissionSchema } from '../../_shared/schemas.ts'
import { ApiReportBodySchema } from '../../_shared/validate.ts'
import { USER_REPORT_CATEGORIES, type UserReportCategory } from '../../_shared/report-category.ts'

Deno.test('the default test-report fixture is the iPad-Safari login bug', () => {
  const fixture = getDemoReportFixture()
  assertEquals(fixture.id, DEFAULT_TEST_REPORT_FIXTURE_ID)
  assertEquals(fixture.id, DEMO_REPORT_FIXTURES[0]?.id)
  assertEquals(fixture.category, 'bug')
  assert(fixture.environment.userAgent.includes('iPad'))
  assertEquals(getDemoReportFixture('does-not-exist').id, DEMO_REPORT_FIXTURES[0]?.id)
})

Deno.test('the test report ships a precomputed diagnosis in the columns classify-report writes', () => {
  const row = precomputedClassification(getDemoReportFixture())
  assert(row, 'the default fixture must carry a diagnosis')
  assertEquals(row.status, 'classified')
  assertEquals(row.stage2_model, 'precomputed')
  assertEquals(row.severity, 'high')
  for (const col of ['title', 'summary', 'component', 'area_tag', 'reproduction_steps', 'confidence']) {
    assert(row[col] !== undefined && row[col] !== null, `${col} must be set`)
  }
  const analysis = row.stage2_analysis as Record<string, unknown>
  assert(typeof analysis.rootCause === 'string' && analysis.rootCause.length > 40)
  assert(typeof analysis.suggestedFix === 'string' && analysis.suggestedFix.length > 40)
  assertEquals(analysis.precomputed, true)
})

Deno.test('fixtures without a diagnosis are left to the real classifier', () => {
  const plain = DEMO_REPORT_FIXTURES.find((f) => !f.diagnosis)
  assert(plain, 'the marketing seed needs fixtures that exercise the classifier')
  assertEquals(precomputedClassification(plain), null)
})

Deno.test('every fixture materializes into a body the ingest schema accepts', () => {
  const now = new Date('2026-09-21T12:00:00Z')
  for (const fixture of DEMO_REPORT_FIXTURES) {
    const body = materializeDemoReport(fixture, {
      projectId: 'proj',
      reporterToken: 'admin-test-u1',
      metadata: { source: 'admin_test_report', userId: 'u1' },
      now,
    })
    const parsed = reportSubmissionSchema.safeParse(body)
    assert(parsed.success, `${fixture.id}: ${parsed.success ? '' : parsed.error.issues[0]?.message}`)
    assertEquals(parsed.success && parsed.data.metadata?.source, 'admin_test_report')
    assertEquals(parsed.success && parsed.data.environment.timestamp, now.toISOString())
    assertEquals(parsed.success && parsed.data.environment.referrer, '')
    // reports.user_category must be a USER category; the classifier target
    // rides in metadata.expected_category.
    assert(parsed.success && USER_REPORT_CATEGORIES.includes(parsed.data.userCategory as UserReportCategory))
    assertEquals(parsed.success && parsed.data.metadata?.expected_category, fixture.category)
    // Route-level union accepts the same body (POST /v1/reports path).
    assertEquals(ApiReportBodySchema.safeParse(body).success, true)
  }
})

Deno.test('relative timestamps are rebased on now and the caller metadata wins', () => {
  const now = new Date('2026-09-21T12:00:00Z')
  const fixture = getDemoReportFixture('ipad-safari-login')
  const body = materializeDemoReport(fixture, {
    projectId: 'proj',
    reporterToken: 'tok',
    metadata: { source: 'admin_test_report' },
    now,
  }) as {
    breadcrumbs: Array<{ timestamp: number; tsOffsetMs?: number }>
    networkLogs: Array<{ timestamp: number; status: number }>
    metadata: Record<string, unknown>
  }
  assertEquals(body.breadcrumbs.length, fixture.breadcrumbs?.length ?? 0)
  for (const crumb of body.breadcrumbs) {
    assert(crumb.timestamp <= now.getTime())
    assert(crumb.timestamp > now.getTime() - 60_000)
    assertEquals('tsOffsetMs' in crumb, false)
  }
  assertEquals(body.networkLogs[0]?.status, 401)
  assertEquals(body.metadata.source, 'admin_test_report')
})
