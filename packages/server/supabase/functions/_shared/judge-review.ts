/**
 * FILE: packages/server/supabase/functions/_shared/judge-review.ts
 * PURPOSE: The review step on /judge (2026-11-19, console UX overhaul): a disagreement row offers
 *          "Accept grader's view" and "Keep diagnosis", and both are plain PATCHes of the report
 *          (PATCH /v1/admin/reports/:id). This file turns the grader's free-text
 *          `suggested_correction` into a body that PATCH accepts, and says whether a person has
 *          already reviewed the disagreement.
 *
 *          - Only values PATCH would accept survive: a classifier category, one of the four
 *            severities, a non-empty component. A suggestion equal to the current value is
 *            dropped (nothing to change). No valid change left → null, and the console hides
 *            "Accept".
 *          - Reviewed = a person set the report's category (reports.category_confirmed_at) at or
 *            after the grade. Both buttons send `category`, so both clear the row without a new
 *            column.
 *
 * Pure: no Deno or database imports, so the vitest suite can exercise it.
 */

import { CLASSIFIER_REPORT_CATEGORIES } from './report-category.ts'
import { REPORT_SEVERITIES } from './report-list-filters.ts'

export interface GraderPatch {
  category?: string
  severity?: string
  component?: string
}

interface ReportNow {
  category: string | null
  severity: string | null
  component: string | null
}

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** The grader's correction as a PATCH body, or null when it changes nothing PATCH would accept. */
export function graderPatch(suggested: unknown, report: ReportNow): GraderPatch | null {
  if (!suggested || typeof suggested !== 'object') return null
  const s = suggested as Record<string, unknown>
  const out: GraderPatch = {}
  const category = clean(s.category)?.toLowerCase() ?? null
  if (category && (CLASSIFIER_REPORT_CATEGORIES as readonly string[]).includes(category) && category !== report.category) {
    out.category = category
  }
  const severity = clean(s.severity)?.toLowerCase() ?? null
  if (severity && (REPORT_SEVERITIES as readonly string[]).includes(severity) && severity !== report.severity) {
    out.severity = severity
  }
  const component = clean(s.component)
  if (component && component.length <= 200 && component !== report.component) out.component = component
  return Object.keys(out).length > 0 ? out : null
}

/** A person set the category at or after this grade: the disagreement has been reviewed. */
export function reviewedAfterGrade(categoryConfirmedAt: string | null | undefined, gradedAt: string): boolean {
  if (!categoryConfirmedAt) return false
  const c = Date.parse(categoryConfirmedAt)
  const g = Date.parse(gradedAt)
  return Number.isFinite(c) && Number.isFinite(g) && c >= g
}
