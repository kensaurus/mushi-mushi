/**
 * FILE: packages/server/supabase/functions/_shared/demo-report-fixtures.ts
 * PURPOSE: Realistic synthetic reports for the console's one-click
 *          "Send test report" (POST /v1/admin/projects/:id/test-report) so a
 *          fresh signup's first diagnosis is an aha, not "Admin pipeline test".
 *
 * The data lives in demo-report-fixtures.json (moved from
 * scripts/marketing/seed-demo.mjs so the marketing seed and the console test
 * report share one set of reports). Timestamps inside the fixtures are stored
 * as `tsOffsetMs` (milliseconds relative to "now", negative = in the past);
 * materializeDemoReport() turns them into absolute epoch-ms at send time.
 *
 * Pure module: no Deno / DB imports so it can be unit-tested with plain
 * `deno test` (see api/routes/demo-report-fixtures.test.ts).
 */

import fixturesRaw from './demo-report-fixtures.json' with { type: 'json' }

export type DemoReportCategory = 'bug' | 'slow' | 'visual' | 'confusing'

interface OffsetStamped {
  tsOffsetMs: number
}

export interface DemoReportFixture {
  id: string
  label: string
  category: DemoReportCategory
  description: string
  userIntent?: string
  performanceMetrics?: Record<string, number>
  consoleLogs?: Array<OffsetStamped & { level: 'log' | 'warn' | 'error' | 'info' | 'debug'; message: string }>
  networkLogs?: Array<OffsetStamped & { method: string; url: string; status: number; duration: number; error?: string }>
  breadcrumbs?: Array<
    OffsetStamped & {
      category: 'navigation' | 'ui.click' | 'ui.tap' | 'console' | 'xhr' | 'fetch' | 'network' | 'lifecycle' | 'custom'
      level: 'debug' | 'info' | 'warning' | 'error'
      message: string
      data?: Record<string, unknown>
    }
  >
  environment: {
    url: string
    userAgent: string
    platform: string
    language: string
    viewport: { width: number; height: number }
    timezone: string
  }
  customMetadata?: Record<string, unknown>
}

export const DEMO_REPORT_FIXTURES: readonly DemoReportFixture[] = fixturesRaw as DemoReportFixture[]

/**
 * reports.user_category holds what a reporter would have picked in the
 * widget (bug | feedback | question | feature | other), not the classifier
 * verdict. The fixture's classifier-vocabulary `category` is what ingest
 * validates against; the expected verdict also rides in
 * metadata.expected_category so the seed/test path can check the classifier.
 */
export const USER_CATEGORY_FOR_FIXTURE: Record<DemoReportCategory, 'bug' | 'other'> = {
  bug: 'bug',
  slow: 'bug',
  visual: 'bug',
  confusing: 'other',
}

/** The fixture the console test report uses: the iPad-Safari login bug. */
export const DEFAULT_TEST_REPORT_FIXTURE_ID = 'ipad-safari-login'

export function getDemoReportFixture(id: string = DEFAULT_TEST_REPORT_FIXTURE_ID): DemoReportFixture {
  const found = DEMO_REPORT_FIXTURES.find((f) => f.id === id)
  if (found) return found
  const first = DEMO_REPORT_FIXTURES[0]
  if (!first) throw new Error('demo-report-fixtures.json is empty')
  return first
}

/**
 * Body for ingestReport(): the fixture with every relative timestamp rebased
 * on `now` plus the fields ingest requires (reporterToken, createdAt, metadata).
 * The caller merges its own `metadata` (e.g. { source: 'admin_test_report' })
 * over the fixture's customMetadata so the report stays excluded from
 * activation counts.
 */
export function materializeDemoReport(
  fixture: DemoReportFixture,
  opts: {
    projectId: string
    reporterToken: string
    metadata?: Record<string, unknown>
    now?: Date
  },
): Record<string, unknown> {
  const now = opts.now ?? new Date()
  const nowMs = now.getTime()
  const nowIso = now.toISOString()
  const stamp = <T extends OffsetStamped>({ tsOffsetMs, ...rest }: T) => ({
    ...rest,
    timestamp: nowMs + tsOffsetMs,
  })

  return {
    projectId: opts.projectId,
    category: fixture.category,
    userCategory: USER_CATEGORY_FOR_FIXTURE[fixture.category] ?? 'other',
    description: fixture.description,
    ...(fixture.userIntent ? { userIntent: fixture.userIntent } : {}),
    ...(fixture.performanceMetrics ? { performanceMetrics: fixture.performanceMetrics } : {}),
    ...(fixture.consoleLogs?.length ? { consoleLogs: fixture.consoleLogs.map(stamp) } : {}),
    ...(fixture.networkLogs?.length ? { networkLogs: fixture.networkLogs.map(stamp) } : {}),
    ...(fixture.breadcrumbs?.length ? { breadcrumbs: fixture.breadcrumbs.map(stamp) } : {}),
    environment: {
      ...fixture.environment,
      referrer: '',
      timestamp: nowIso,
    },
    reporterToken: opts.reporterToken,
    metadata: {
      ...(fixture.customMetadata ?? {}),
      expected_category: fixture.category,
      ...(opts.metadata ?? {}),
    },
    createdAt: nowIso,
  }
}
