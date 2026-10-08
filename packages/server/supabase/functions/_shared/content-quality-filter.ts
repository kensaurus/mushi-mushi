/**
 * content-quality-filter.ts — one filter for the Content checks list and its
 * bulk dismiss, plus the ingest rule that keeps a dismissed row dismissed.
 *
 * The list route and the dismiss route both turn a filter into the same
 * PostgREST operations, so "dismiss all matching" touches exactly the rows
 * the page shows. Pure: no Deno or Supabase imports, so vitest can load it.
 */

import { z } from 'npm:zod@3'

/** Most ids one call may name. */
export const BULK_DISMISS_MAX_IDS = 500
/** Most rows one call may dismiss; a larger match is dismissed in runs. */
export const BULK_DISMISS_MAX_ROWS = 10_000

const REASONS = ['low_judge_score', 'user_flag', 'low_star_rating', 'high_downvote_ratio'] as const

/**
 * Bands of `judge_score`, the score the source app sent. `unscored` is a
 * null score; the numeric bands are [0, 0.3), [0.3, 0.6) and [0.6, 1].
 */
const SCORE_BANDS = ['unscored', 'below_0_3', '0_3_to_0_6', '0_6_and_up'] as const
type ScoreBand = (typeof SCORE_BANDS)[number]

/** Rows a person may bulk-dismiss. `regenerating` is excluded: the regen
 *  callback writes its own status and would undo the dismissal. */
const DISMISSABLE_STATUSES = ['open', 'in_review'] as const

/** Query-string value for "rows with no source" (seed and test rows). */
const NO_SOURCE = '__none__'

const rowFilterShape = {
  reason: z.enum(REASONS).optional(),
  content_type: z.string().min(1).max(100).optional(),
  /** `null` matches rows with no source. */
  source: z.string().min(1).max(100).nullable().optional(),
  score_band: z.enum(SCORE_BANDS).optional(),
}

const dismissFilterSchema = z
  .object({ status: z.enum(DISMISSABLE_STATUSES).default('open'), ...rowFilterShape })
  .strict()

type RowFilter = {
  reason?: (typeof REASONS)[number]
  content_type?: string
  source?: string | null
  score_band?: ScoreBand
}

export const bulkDismissBodySchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(BULK_DISMISS_MAX_IDS).optional(),
    filter: dismissFilterSchema.optional(),
    /** Why these rows are noise. Required unless this is a dry run. */
    reason: z.string().trim().max(500).optional(),
    /** The count the person confirmed; a different live count is a 409. */
    expected_count: z.number().int().min(0).optional(),
    dry_run: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if ((body.ids ? 1 : 0) + (body.filter ? 1 : 0) !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Send either ids or filter, not both or neither.' })
    }
    if (!body.dry_run && (!body.reason || body.reason.length < 3)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Say why these rows are dismissed (at least 3 characters).' })
    }
  })

export type FilterOp =
  | { op: 'eq'; column: string; value: string }
  | { op: 'is_null'; column: string }
  | { op: 'lt' | 'gte'; column: string; value: number }

/** The PostgREST operations for a row filter (status is applied by the caller). */
export function contentQualityFilterOps(filter: RowFilter): FilterOp[] {
  const ops: FilterOp[] = []
  if (filter.reason) ops.push({ op: 'eq', column: 'reason', value: filter.reason })
  if (filter.content_type) ops.push({ op: 'eq', column: 'content_type', value: filter.content_type })
  if (filter.source === null) ops.push({ op: 'is_null', column: 'source' })
  else if (filter.source) ops.push({ op: 'eq', column: 'source', value: filter.source })
  switch (filter.score_band) {
    case 'unscored':
      ops.push({ op: 'is_null', column: 'judge_score' })
      break
    case 'below_0_3':
      ops.push({ op: 'lt', column: 'judge_score', value: 0.3 })
      break
    case '0_3_to_0_6':
      ops.push({ op: 'gte', column: 'judge_score', value: 0.3 }, { op: 'lt', column: 'judge_score', value: 0.6 })
      break
    case '0_6_and_up':
      ops.push({ op: 'gte', column: 'judge_score', value: 0.6 })
      break
  }
  return ops
}

/**
 * The list route's row filter from its query string. Unknown reasons and
 * bands are ignored rather than refused, as the list always was.
 */
export function rowFilterFromSearchParams(params: URLSearchParams): RowFilter {
  const filter: RowFilter = {}
  const reason = params.get('reason')
  if (reason && (REASONS as readonly string[]).includes(reason)) filter.reason = reason as RowFilter['reason']
  const contentType = params.get('content_type')
  if (contentType) filter.content_type = contentType.slice(0, 100)
  const source = params.get('source')
  if (source === NO_SOURCE) filter.source = null
  else if (source) filter.source = source.slice(0, 100)
  const band = params.get('score_band')
  if (band && (SCORE_BANDS as readonly string[]).includes(band)) filter.score_band = band as ScoreBand
  return filter
}

// ── Ingest: does a re-sent issue bring anything new? ─────────────────────────

interface SignalSnapshot {
  flag_count?: number | null
  judge_score?: number | string | null
  avg_star?: number | string | null
  feedback_summary?: Record<string, unknown> | null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

/** A score must fall this far below the dismissed value to count as worse. */
const SCORE_DROP = 0.1
const STAR_DROP = 0.5

/**
 * What is materially worse in `next` than in the row a person dismissed or
 * resolved (`prev`). Empty means nothing new: the row stays closed. Only new
 * flags, new downvotes or a clear score drop count. A signal the closed row
 * never recorded (null) is no baseline, so it never reopens the row.
 */
export function materiallyNewSignals(prev: SignalSnapshot, next: SignalSnapshot): string[] {
  const changes: string[] = []
  const prevFlags = num(prev.flag_count)
  const nextFlags = num(next.flag_count)
  if (prevFlags != null && nextFlags != null && nextFlags > prevFlags) {
    changes.push(`flags ${prevFlags} -> ${nextFlags}`)
  }
  const prevDown = num(prev.feedback_summary?.downvotes)
  const nextDown = num(next.feedback_summary?.downvotes)
  if (prevDown != null && nextDown != null && nextDown > prevDown) {
    changes.push(`downvotes ${prevDown} -> ${nextDown}`)
  }
  const prevScore = num(prev.judge_score)
  const nextScore = num(next.judge_score)
  if (prevScore != null && nextScore != null && prevScore - nextScore >= SCORE_DROP - 1e-9) {
    changes.push(`score ${prevScore} -> ${nextScore}`)
  }
  const prevStar = num(prev.avg_star)
  const nextStar = num(next.avg_star)
  if (prevStar != null && nextStar != null && prevStar - nextStar >= STAR_DROP - 1e-9) {
    changes.push(`stars ${prevStar} -> ${nextStar}`)
  }
  return changes
}

/**
 * A regeneration counts as stale after this long without a callback. The
 * source project's regen takes about a minute; a lost callback must not lock
 * the item forever.
 */
export const REGEN_STALE_MS = 15 * 60 * 1000

/** True when a running or queued regeneration may be requested again. */
export function isRegenStale(requestedAt: string | null | undefined, nowMs: number): boolean {
  if (!requestedAt) return true
  const t = Date.parse(requestedAt)
  return Number.isNaN(t) || nowMs - t >= REGEN_STALE_MS
}
