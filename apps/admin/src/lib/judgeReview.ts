/**
 * FILE: apps/admin/src/lib/judgeReview.ts
 * PURPOSE: Triage grading as a job to finish (console UX overhaul, 2026-11-19): the page leads with
 *          "7 of 12 diagnoses disagreed with the grader · Review 7", and each disagreement row
 *          offers "Accept grader's view" or "Keep diagnosis". Pure helpers, unit tested.
 *
 *          Both buttons PATCH the report (/v1/admin/reports/:id). Both send `category`, which
 *          stamps reports.category_confirmed_at: that is how the server knows a person reviewed
 *          the row (`reviewed` on GET /judge/evaluations, `recentToReview` on /judge/stats). It
 *          also counts as a person confirming the category, which lets a reporter's feature
 *          request go to auto-fix; the buttons' titles say so.
 *          An older server sends neither `grader_patch` nor `reviewed`: the row then offers
 *          "Open report" only.
 */

import type { JudgeStats } from '../components/judge/JudgeStatsTypes'
import type { PageStatusTone } from '../components/ui/page-status'

/** Agreement the page treats as healthy: the same 80% line the grade colours use (ScorePill). */
export const AGREEMENT_TARGET_PCT = 80

/** The PATCH body the server built from the grader's suggestion (_shared/judge-review.ts). */
export interface GraderPatch {
  category?: string
  severity?: string
  component?: string
}

export interface ReviewRowFields {
  report_category?: string | null
  grader_patch?: GraderPatch | null
  reviewed?: boolean
  judge_reasoning?: string | null
}

export interface JudgeLead {
  sentence: string
  tone: PageStatusTone
  /** Disagreements still waiting for a person: the "Review N" button. 0 hides it. */
  toReview: number
  /** Agreement over the counted window, 0–100, or null with nothing graded. */
  agreementPct: number | null
  disagreed: number
  graded: number
  windowWords: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The status line: what is wrong, then the one thing to do. */
export function judgeLead(stats: JudgeStats): JudgeLead {
  const recent = stats.recentEvaluations != null && stats.recentDisagreements != null
  const days = stats.recentWindowDays ?? 14
  const graded = recent ? stats.recentEvaluations! : stats.totalEvaluations
  const disagreed = recent ? stats.recentDisagreements! : stats.disagreementCount
  const windowWords = recent ? `in the last ${days} days` : 'so far'
  const toReview = Math.max(0, Math.min(disagreed, recent && stats.recentToReview != null ? stats.recentToReview : disagreed))
  const agreementPct = graded > 0 ? Math.round(((graded - disagreed) / graded) * 100) : null
  const base = { toReview, agreementPct, disagreed, graded, windowWords }

  if (stats.totalEvaluations === 0) {
    return {
      ...base,
      toReview: 0,
      tone: 'neutral',
      sentence:
        stats.ungradedReports > 0
          ? `Nothing graded yet; ${plural(stats.ungradedReports, 'diagnosed report')} ${stats.ungradedReports === 1 ? 'is' : 'are'} ready.`
          : 'Nothing graded yet. Grades start once reports are diagnosed.',
    }
  }
  if (graded === 0) return { ...base, tone: 'neutral', sentence: `Nothing was graded ${windowWords}.` }
  if (disagreed === 0) return { ...base, tone: 'ok', sentence: `The grader agreed with all ${plural(graded, 'diagnosis', 'diagnoses')} ${windowWords}.` }
  const head = `${disagreed} of ${plural(graded, 'diagnosis', 'diagnoses')} ${windowWords} disagreed with the grader.`
  if (toReview === 0) return { ...base, tone: 'ok', sentence: `${head} You reviewed them all.` }
  const tail = toReview < disagreed ? ` ${toReview} still need${toReview === 1 ? 's' : ''} your review before you merge ${toReview === 1 ? 'its fix' : 'their fixes'}.` : ' Review them before merging those fixes.'
  return { ...base, tone: agreementPct != null && agreementPct < 60 ? 'danger' : 'warn', sentence: `${head}${tail}` }
}

const FIELD_WORD: Record<keyof GraderPatch, string> = { category: 'Category', severity: 'Severity', component: 'Area' }

/** "Severity → high · Area → Cart": what accepting changes. Empty when there is nothing. */
export function patchWords(patch: GraderPatch | null | undefined): string {
  if (!patch) return ''
  return (Object.keys(FIELD_WORD) as Array<keyof GraderPatch>)
    .filter((k) => patch[k])
    .map((k) => `${FIELD_WORD[k]} → ${patch[k]}`)
    .join(' · ')
}

export type ReviewChoice = 'accept' | 'keep'

/**
 * The PATCH body for a choice, or null when that choice is not offered for the row:
 *   accept → the grader's changes, plus the current category when the grader left it alone
 *            (so the row counts as reviewed);
 *   keep   → the current category again, with a note saying the grader was overruled.
 * A row with no category to confirm can't be marked reviewed, so neither is offered.
 */
export function reviewBody(row: ReviewRowFields, choice: ReviewChoice): Record<string, string> | null {
  if (row.reviewed) return null
  const current = row.report_category?.trim() || null
  if (choice === 'accept') {
    const patch = row.grader_patch
    if (!patch || patchEmpty(patch)) return null
    const category = patch.category ?? current
    if (!category) return null
    return { ...stripEmpty(patch), category, note: `Accepted the grader's view: ${patchWords(patch)}.` }
  }
  if (!current || row.reviewed === undefined) return null
  return { category: current, note: 'Kept the diagnosis after the grader disagreed.' }
}

function patchEmpty(p: GraderPatch): boolean {
  return !p.category && !p.severity && !p.component
}

function stripEmpty(p: GraderPatch): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(p)) if (typeof v === 'string' && v) out[k] = v
  return out
}

/** The grader's reason cut to its first sentence, for a one-line row. */
export function firstSentence(text: string | null | undefined): string | null {
  if (!text) return null
  const t = text.trim()
  if (!t) return null
  const m = /^(.{20,280}?[.!?])(\s|$)/.exec(t)
  return m ? m[1]! : t.length > 280 ? `${t.slice(0, 277)}…` : t
}
