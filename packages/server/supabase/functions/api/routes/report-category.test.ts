import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  CLASSIFIER_REPORT_CATEGORIES,
  REPORT_CATEGORY_UNION,
  USER_REPORT_CATEGORIES,
  normalizeReportCategory,
  toClassifierCategory,
} from '../../_shared/report-category.ts'
import { ApiReportBodySchema } from '../../_shared/validate.ts'
import { reportSubmissionSchema } from '../../_shared/schemas.ts'

const baseBody = {
  projectId: 'proj',
  description: 'The feedback form loses my text when I switch tabs on mobile.',
  environment: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
    platform: 'iPhone',
    language: 'en-US',
    viewport: { width: 393, height: 852 },
    url: '/settings',
    referrer: '',
    timestamp: '2026-09-21T12:00:00.000Z',
    timezone: 'UTC',
  },
  reporterToken: 'tok_feedback_test',
  createdAt: '2026-09-21T12:00:00.000Z',
}

Deno.test('the route enum is the union of the user and classifier vocabularies', () => {
  for (const c of USER_REPORT_CATEGORIES) assert(REPORT_CATEGORY_UNION.includes(c), c)
  for (const c of CLASSIFIER_REPORT_CATEGORIES) assert(REPORT_CATEGORY_UNION.includes(c), c)
  assertEquals(new Set(REPORT_CATEGORY_UNION).size, REPORT_CATEGORY_UNION.length)
  // The schemas agree with the constants (the bug being fixed: they did not).
  for (const c of REPORT_CATEGORY_UNION) {
    assertEquals(ApiReportBodySchema.safeParse({ ...baseBody, category: c }).success, true, `route: ${c}`)
    assertEquals(
      reportSubmissionSchema.safeParse(normalizeReportCategory({ ...baseBody, category: c })).success,
      true,
      `ingest: ${c}`,
    )
  }
})

Deno.test("a 'feedback' report passes the route AND the ingest schema, landing as user_category=feedback / category=other", () => {
  const body = { ...baseBody, category: 'feedback' }
  assertEquals(ApiReportBodySchema.safeParse(body).success, true)
  // Before the fix this is exactly what failed: the ingest schema is classifier-only.
  assertEquals(reportSubmissionSchema.safeParse(body).success, false)

  const normalized = normalizeReportCategory(body)
  const parsed = reportSubmissionSchema.safeParse(normalized)
  assert(parsed.success, parsed.success ? '' : parsed.error.issues[0]?.message)
  if (parsed.success) {
    assertEquals(parsed.data.category, 'other')
    // What ingestReport stores: user_category = report.userCategory ?? report.category
    assertEquals(parsed.data.userCategory ?? parsed.data.category, 'feedback')
  }
  for (const c of ['question', 'feature'] as const) {
    const p = reportSubmissionSchema.safeParse(normalizeReportCategory({ ...baseBody, category: c }))
    assert(p.success)
    if (p.success) {
      assertEquals(p.data.category, 'other')
      assertEquals(p.data.userCategory, c)
    }
  }
})

Deno.test('classifier-valued bodies (the SDK path) are returned untouched', () => {
  for (const c of CLASSIFIER_REPORT_CATEGORIES) {
    const body = { ...baseBody, category: c }
    const out = normalizeReportCategory(body)
    assertEquals(out, body)
    assertEquals(out.category, c)
    assertEquals('userCategory' in out, false)
  }
  // An explicit userCategory from the widget is never overwritten.
  const explicit = normalizeReportCategory({ ...baseBody, category: 'feature', userCategory: 'roadmap_idea' })
  assertEquals(explicit.userCategory, 'roadmap_idea')
  assertEquals(explicit.category, 'other')
  // Missing / non-string category is left for the schema to reject.
  assertEquals(normalizeReportCategory({ ...baseBody } as Record<string, unknown>).category, undefined)
  assertEquals(toClassifierCategory('feedback'), 'other')
  assertEquals(toClassifierCategory('slow'), 'slow')
  assertEquals(toClassifierCategory(undefined), 'other')
})
