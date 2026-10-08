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

// ---------------------------------------------------------------------------
// Feature requests (2026-10-02)
//
// A reporter can say "this is a feature request" two ways: POST /v1/reports
// with category 'feature' (→ user_category='feature'), or the web widget's
// Feature request card, which sends category 'other' plus
// user_intent='Feature request' (packages/web FEATURE_REQUEST_INTENT). Both
// classifiers ignored it: QA's three feature requests (469f6962, 08d0ecde,
// c0e99783) were classified visual / visual / confusing and 469f6962 was
// fed to auto-fix, which opened PR 424.
// ---------------------------------------------------------------------------

/** Wire value the widget's Feature request card writes into `user_intent`. */
const FEATURE_REQUEST_INTENT = 'feature request'
const FEATURE_USER_CATEGORIES: ReadonlySet<string> = new Set(['feature', 'feature request', 'feature_request'])

function lower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isFeatureRequest(report: { user_category?: unknown; user_intent?: unknown }): boolean {
  return FEATURE_USER_CATEGORIES.has(lower(report.user_category)) || lower(report.user_intent) === FEATURE_REQUEST_INTENT
}

/**
 * The reporter's explicit choice wins over the model's guess: a feature
 * request is never stored under a defect category. The model's guess is kept
 * as `model_category` for the record.
 */
export function respectReporterCategory<T extends { category: string }>(
  classification: T,
  report: { user_category?: unknown; user_intent?: unknown },
): T {
  if (!isFeatureRequest(report) || classification.category === 'other') return classification
  return { ...classification, category: 'other', model_category: classification.category } as T
}

/**
 * Prompt line naming the reporter's own label. Stage 1 sees raw report text
 * anyway; Stage 2 is the air-gapped stage, so `trusted` emits only values
 * derived from fixed vocabularies, never the raw user_category string.
 */
export function reporterCategoryHint(
  report: { user_category?: unknown; user_intent?: unknown },
  opts: { trusted: boolean },
): string {
  if (isFeatureRequest(report)) {
    return '- Reporter chose: Feature request. This is a strong signal from the person who filed it: treat it as a request for new or changed behaviour, not a defect, and use category "other".'
  }
  const raw = typeof report.user_category === 'string' ? report.user_category.trim() : ''
  if (!raw) return ''
  const label = opts.trusted ? toClassifierCategory(raw) : raw.slice(0, 128)
  return `- Reporter chose: ${label} (strong hint; override it only when the evidence clearly says otherwise)`
}

function storedCategory(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const c = (value as { category?: unknown }).category
  return typeof c === 'string' && c ? c : null
}

/**
 * Why a fix must not be dispatched for this report, or null when it may be.
 * A feature request is only eligible once a human re-categorized it: its
 * category is a non-'other' value that differs from what the classifier
 * stored (stage 2's category, else stage 1's), or a person confirmed a
 * non-'other' category in triage (`category_confirmed_at`). The confirmation
 * matters when the person agrees with the classifier: without it, confirming
 * "yes, it is visual" left the report blocked with no way out.
 */
export function featureRequestDispatchBlock(report: {
  user_category?: unknown
  user_intent?: unknown
  category?: string | null
  stage1_classification?: unknown
  stage2_analysis?: unknown
  category_confirmed_at?: string | null
}): string | null {
  if (!isFeatureRequest(report)) return null
  if (report.category_confirmed_at && typeof report.category === 'string' && report.category !== 'other') return null
  const classifierCategory = storedCategory(report.stage2_analysis) ?? storedCategory(report.stage1_classification)
  const humanRecategorized =
    typeof report.category === 'string' && report.category !== 'other' && report.category !== classifierCategory
  if (humanRecategorized) return null
  return 'The reporter filed this as a feature request, so it is not sent to auto-fix. Set its Category in triage to dispatch a fix.'
}
