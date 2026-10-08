/**
 * FILE: content-quality-bulk-dismiss.test.ts
 * PURPOSE: Content checks noise (glot.it triage, 2026-10-07: 6,081 open rows,
 *          almost all noise).
 *            1. Bulk dismiss: one filter for the list and the dismiss, a body
 *               that takes ids (≤ 500) or a filter, a required reason, and a
 *               route that is JWT-only, member-not-viewer, project-scoped,
 *               capped at 10,000 rows, count-confirmed and audited.
 *            2. Ingest keeps a dismissed row dismissed unless the re-send is
 *               materially worse.
 *          Pure helpers are unit-tested; route wiring is checked at source
 *          level (no Deno boot), like content-quality-admin-safety.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isRegenStale,
  REGEN_STALE_MS,
  BULK_DISMISS_MAX_ROWS,
  bulkDismissBodySchema,
  contentQualityFilterOps,
  materiallyNewSignals,
  rowFilterFromSearchParams,
} from '../../supabase/functions/_shared/content-quality-filter.ts'

const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/content-quality.ts'), 'utf8')

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('bulkDismissBodySchema', () => {
  it('takes ids or a filter, never both or neither', () => {
    expect(bulkDismissBodySchema.safeParse({ ids: [ID(1)], reason: 'test rows' }).success).toBe(true)
    expect(bulkDismissBodySchema.safeParse({ filter: { reason: 'user_flag' }, reason: 'test rows' }).success).toBe(true)
    expect(bulkDismissBodySchema.safeParse({ reason: 'test rows' }).success).toBe(false)
    expect(bulkDismissBodySchema.safeParse({ ids: [ID(1)], filter: {}, reason: 'test rows' }).success).toBe(false)
  })

  it('requires a reason unless it is a dry run', () => {
    expect(bulkDismissBodySchema.safeParse({ ids: [ID(1)] }).success).toBe(false)
    expect(bulkDismissBodySchema.safeParse({ ids: [ID(1)], reason: '  x ' }).success).toBe(false)
    expect(bulkDismissBodySchema.safeParse({ ids: [ID(1)], dry_run: true }).success).toBe(true)
  })

  it('caps ids at 500 and only dismisses open or in-review rows by filter', () => {
    const ids = Array.from({ length: 501 }, (_, i) => ID(i))
    expect(bulkDismissBodySchema.safeParse({ ids, reason: 'noise' }).success).toBe(false)
    expect(bulkDismissBodySchema.safeParse({ ids: ids.slice(0, 500), reason: 'noise' }).success).toBe(true)
    expect(bulkDismissBodySchema.safeParse({ filter: { status: 'regenerating' }, reason: 'noise' }).success).toBe(false)
    expect(bulkDismissBodySchema.safeParse({ filter: { status: 'dismissed' }, reason: 'noise' }).success).toBe(false)
    const parsed = bulkDismissBodySchema.parse({ filter: {}, reason: 'noise' })
    expect(parsed.filter?.status).toBe('open')
  })

  it('refuses unknown keys and non-uuid ids', () => {
    expect(bulkDismissBodySchema.safeParse({ filter: { project_id: ID(9) }, reason: 'noise' }).success).toBe(false)
    expect(bulkDismissBodySchema.safeParse({ ids: ['not-a-uuid'], reason: 'noise' }).success).toBe(false)
  })
})

describe('contentQualityFilterOps / rowFilterFromSearchParams', () => {
  it('maps every filter field, with null source as "no source"', () => {
    expect(
      contentQualityFilterOps({ reason: 'user_flag', content_type: 'mnemonic', source: null, score_band: 'unscored' }),
    ).toEqual([
      { op: 'eq', column: 'reason', value: 'user_flag' },
      { op: 'eq', column: 'content_type', value: 'mnemonic' },
      { op: 'is_null', column: 'source' },
      { op: 'is_null', column: 'judge_score' },
    ])
    expect(contentQualityFilterOps({ source: 'glot.it', score_band: '0_3_to_0_6' })).toEqual([
      { op: 'eq', column: 'source', value: 'glot.it' },
      { op: 'gte', column: 'judge_score', value: 0.3 },
      { op: 'lt', column: 'judge_score', value: 0.6 },
    ])
    expect(contentQualityFilterOps({})).toEqual([])
  })

  it('reads the list query string the same way the dismiss body is read', () => {
    const p = new URLSearchParams({ reason: 'user_flag', content_type: 'mnemonic', source: '__none__', score_band: 'below_0_3' })
    expect(rowFilterFromSearchParams(p)).toEqual({
      reason: 'user_flag',
      content_type: 'mnemonic',
      source: null,
      score_band: 'below_0_3',
    })
    expect(rowFilterFromSearchParams(new URLSearchParams({ reason: 'bogus', score_band: 'x' }))).toEqual({})
  })
})

describe('materiallyNewSignals (dismissals stick)', () => {
  const dismissed = {
    flag_count: 8,
    judge_score: 0.342,
    avg_star: null,
    feedback_summary: { upvotes: 2, downvotes: 0, total_ratings: 0 },
  }

  it('the same re-send is nothing new', () => {
    expect(materiallyNewSignals(dismissed, { ...dismissed })).toEqual([])
  })

  it('better or slightly lower signals are nothing new', () => {
    expect(materiallyNewSignals(dismissed, { ...dismissed, flag_count: 1, judge_score: 0.4 })).toEqual([])
    expect(materiallyNewSignals(dismissed, { ...dismissed, judge_score: 0.3 })).toEqual([])
  })

  it('new flags, new downvotes or a clear score drop reopen the row', () => {
    expect(materiallyNewSignals(dismissed, { ...dismissed, flag_count: 9 })).toEqual(['flags 8 -> 9'])
    expect(
      materiallyNewSignals(dismissed, { ...dismissed, feedback_summary: { upvotes: 2, downvotes: 1 } }),
    ).toEqual(['downvotes 0 -> 1'])
    expect(materiallyNewSignals(dismissed, { ...dismissed, judge_score: 0.2 })).toHaveLength(1)
    expect(materiallyNewSignals({ ...dismissed, avg_star: 3 }, { ...dismissed, avg_star: 2.4 })).toHaveLength(1)
  })

  it('a signal the dismissed row never had is no baseline', () => {
    const noSummary = { flag_count: 12, judge_score: null, avg_star: null, feedback_summary: null }
    expect(
      materiallyNewSignals(noSummary, { flag_count: 12, judge_score: 0.1, feedback_summary: { downvotes: 5 } }),
    ).toEqual([])
  })

  it('reads numeric strings as numbers (a numeric column can arrive as a string)', () => {
    expect(materiallyNewSignals({ judge_score: '0.5' }, { judge_score: 0.3 })).toHaveLength(1)
  })
})

describe('bulk dismiss route wiring', () => {
  const start = src.indexOf("app.post('/v1/admin/projects/:pid/content-quality/dismiss'")
  const route = src.slice(start)

  it('is JWT-only and refuses non-members and viewers before any write', () => {
    expect(start).toBeGreaterThan(0)
    expect(route).toMatch(/^app\.post\('\/v1\/admin\/projects\/:pid\/content-quality\/dismiss', jwtAuth, async/)
    const firstWrite = route.indexOf('.update(')
    expect(route.indexOf('callerCanAccessProject(c, db, userId, projectId)')).toBeLessThan(firstWrite)
    expect(route.indexOf('denyViewerWrite(c, access.role')).toBeLessThan(firstWrite)
  })

  it('scopes every update to the project and to dismissable statuses', () => {
    const updates = route.split('.update(').slice(1)
    expect(updates).toHaveLength(2)
    for (const u of updates) {
      const head = u.slice(0, 400)
      expect(head).toContain(".eq('project_id', projectId)")
      expect(head).toMatch(/\.in\('status', \['open', 'in_review'\]\)|\.eq\('status', body\.filter\.status\)/)
    }
  })

  it('caps by id boundary, confirms the count, and audits the reason', () => {
    expect(BULK_DISMISS_MAX_ROWS).toBe(10_000)
    expect(route).toContain('Math.min(matched, BULK_DISMISS_MAX_ROWS)')
    expect(route).toContain(".range(willDismiss - 1, willDismiss - 1)")
    expect(route).toContain(".lte('id', boundary.id as string)")
    expect(route).toMatch(/body\.expected_count !== willDismiss[\s\S]{0,300}COUNT_CHANGED[\s\S]{0,300}409/)
    expect(route).toContain("'content_quality.bulk_dismissed'")
    expect(route).toContain('reason: body.reason')
    // A dry run returns before anything is written.
    expect(route.indexOf('if (body.dry_run)')).toBeLessThan(route.indexOf('.update('))
  })
})

describe('ingest keeps a dismissed row dismissed', () => {
  const ingest = src.slice(src.indexOf("app.post('/v1/content-quality', apiKeyAuth"), src.indexOf("app.post('/v1/content-quality/callback'"))

  it('looks up the latest non-open row for the same key when no open row exists', () => {
    const prior = ingest.slice(ingest.indexOf('const { data: prior }'))
    expect(prior).toMatch(/\.eq\('content_ref', issue\.content_ref\)\s*\.eq\('reason', issue\.reason\)\s*\.neq\('status', 'open'\)/)
    expect(prior).toContain(".order('updated_at', { ascending: false })")
    expect(prior).toContain('.limit(1)')
  })

  it('returns without writing when nothing is materially new, and reopens otherwise', () => {
    const block = ingest.slice(ingest.indexOf('if (changes.length === 0) {'))
    const keep = block.slice(0, block.indexOf('}'))
    expect(keep).not.toContain('.update(')
    expect(keep).toContain('created: false, status: prior.status')
    expect(block).toContain(".update({ ...signals(), status: 'open' })")
  })

  it('does not open a second row next to one already in review or regenerating', () => {
    expect(ingest).toMatch(/prior\.status === 'in_review' \|\| prior\.status === 'regenerating'/)
  })
})

describe('isRegenStale', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')
  it('keeps a fresh regeneration locked', () => {
    expect(isRegenStale(new Date(now - 60_000).toISOString(), now)).toBe(false)
  })
  it('frees one whose callback never arrived', () => {
    expect(isRegenStale(new Date(now - REGEN_STALE_MS).toISOString(), now)).toBe(true)
  })
  it('frees one with no or a bad start time', () => {
    expect(isRegenStale(null, now)).toBe(true)
    expect(isRegenStale('nope', now)).toBe(true)
  })
})
