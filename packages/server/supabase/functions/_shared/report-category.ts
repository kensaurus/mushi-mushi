/**
 * FILE: packages/server/supabase/functions/_shared/report-category.ts
 * PURPOSE: One place for the two report category vocabularies and the
 *          mapping between them.
 *
 *   USER categories   — what a reporter picks in the widget / POST /v1/reports:
 *                       bug | feedback | question | feature | other
 *   CLASSIFIER categories — what the triage LLM assigns and what
 *                       reports.category is CHECKed against:
 *                       bug | slow | visual | confusing | other
 *
 * Before this module the route Zod accepted the USER enum and ingestReport()
 * re-validated against the CLASSIFIER enum, so 'feedback' / 'question' /
 * 'feature' passed the route and then failed with INGEST_ERROR. The ingest
 * path now accepts the union: the user's word is kept in
 * `reports.user_category`, and `category` is mapped onto the classifier
 * vocabulary (user-only values → 'other') before the classifier check.
 * Classifier values pass through untouched, so SDK behaviour is unchanged.
 *
 * Pure module (no imports) — unit-tested in api/routes/report-category.test.ts.
 */

export const USER_REPORT_CATEGORIES = ['bug', 'feedback', 'question', 'feature', 'other'] as const
export const CLASSIFIER_REPORT_CATEGORIES = ['bug', 'slow', 'visual', 'confusing', 'other'] as const

export type UserReportCategory = (typeof USER_REPORT_CATEGORIES)[number]
export type ClassifierReportCategory = (typeof CLASSIFIER_REPORT_CATEGORIES)[number]

/** Every value either layer accepts, deduplicated, for the route-level Zod enum. */
export const REPORT_CATEGORY_UNION = [
  'bug',
  'feedback',
  'question',
  'feature',
  'slow',
  'visual',
  'confusing',
  'other',
] as const satisfies readonly (UserReportCategory | ClassifierReportCategory)[]

const CLASSIFIER_SET: ReadonlySet<string> = new Set(CLASSIFIER_REPORT_CATEGORIES)

export function isClassifierCategory(value: unknown): value is ClassifierReportCategory {
  return typeof value === 'string' && CLASSIFIER_SET.has(value)
}

/** user → classifier: classifier values pass through, user-only values → 'other'. */
export function toClassifierCategory(value: unknown): ClassifierReportCategory {
  return isClassifierCategory(value) ? value : 'other'
}

/**
 * Applied by ingestReport() before the classifier-enum schema check.
 * Returns a shallow copy with:
 *   - `category` on the classifier vocabulary
 *   - `userCategory` preserved when the caller sent one, else set to the
 *     original user-only value ('feedback' | 'question' | 'feature') so it
 *     lands in reports.user_category. Classifier-valued bodies are untouched.
 */
export function normalizeReportCategory<T extends Record<string, unknown>>(body: T): T {
  const raw = body.category
  if (typeof raw !== 'string' || isClassifierCategory(raw)) return body
  return {
    ...body,
    category: toClassifierCategory(raw),
    userCategory: typeof body.userCategory === 'string' && body.userCategory ? body.userCategory : raw,
  }
}
