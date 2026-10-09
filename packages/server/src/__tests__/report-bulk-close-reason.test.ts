/**
 * FILE: report-bulk-close-reason.test.ts
 * PURPOSE: A bulk close carries its reason to the row, the reporter and undo.
 *
 * Regression (2026-10-09): ten HHTP reports closed together as "couldn't
 * reproduce" were stored with no reason and every reporter got a bare
 * "closed". The reports route imports Deno-only code, so its wiring is read
 * from source, as report-list-truth.test.ts does.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BULK_CLOSED_REASONS, bulkClosedReason } from '../../supabase/functions/_shared/report-close-reasons.ts'

const REPORTS = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/reports.ts'), 'utf8')
const routeBody = (marker: string, length: number) => {
  const at = REPORTS.indexOf(marker)
  expect(at, marker).toBeGreaterThan(-1)
  return REPORTS.slice(at, at + length)
}

describe('bulkClosedReason', () => {
  it('keeps the reason a dismiss gives', () => {
    expect(bulkClosedReason('dismissed', 'not_reproducible')).toEqual({ ok: true, value: 'not_reproducible' })
    expect(bulkClosedReason('dismissed', 'spam')).toEqual({ ok: true, value: 'spam' })
  })

  it('leaves the reason alone for a dismiss without one', () => {
    for (const r of [undefined, null, '']) expect(bulkClosedReason('dismissed', r)).toEqual({ ok: true, value: undefined })
  })

  it('clears an old reason when reports are reopened or fixed', () => {
    expect(bulkClosedReason('classified', 'spam')).toEqual({ ok: true, value: null })
    expect(bulkClosedReason('fixed', undefined)).toEqual({ ok: true, value: null })
  })

  it('does not touch the reason when the status is not changing', () => {
    expect(bulkClosedReason(undefined, 'spam')).toEqual({ ok: true, value: undefined })
  })

  it('rejects duplicate and unknown reasons', () => {
    expect(BULK_CLOSED_REASONS.has('duplicate')).toBe(false)
    for (const r of ['duplicate', 'nope', 42]) expect(bulkClosedReason('dismissed', r).ok).toBe(false)
  })
})

describe('bulk route wiring', () => {
  const bulk = routeBody("app.post('/v1/admin/reports/bulk', jwtAuth", 9000)

  it('validates, stores and announces the reason', () => {
    expect(bulk).toContain('bulkClosedReason(updates.status, body.reason)')
    expect(bulk).toContain("closedReason: (updates.closed_reason as string | null | undefined) ?? null")
  })

  it('records the prior reason so undo can put it back', () => {
    expect(bulk).toContain("select('id, project_id, reporter_token_hash, status, severity, category, closed_reason')")
    expect(bulk).toContain('closed_reason: (prev as { closed_reason?: string | null } | undefined)?.closed_reason ?? null')
    const undo = routeBody("app.post('/v1/admin/reports/bulk/:mutationId/undo'", 5000)
    expect(undo).toContain('if (prev.closed_reason !== undefined) patch.closed_reason = prev.closed_reason;')
  })
})

describe('single-report reopen', () => {
  // A report reopened by hand left reopened_at null, so the console's
  // regression chain never showed it (2026-10-09).
  it('choosing Reopened stamps reopened_at on the server, after the client whitelist', () => {
    const patch = REPORTS.slice(REPORTS.indexOf("app.patch('/v1/admin/reports/:id'"))
    const whitelist = patch.indexOf('allowedFields[key]')
    const stamp = patch.indexOf("if (updates.status === 'reopened') {")
    expect(whitelist).toBeGreaterThan(0)
    expect(stamp).toBeGreaterThan(whitelist)
    expect(patch.slice(stamp, stamp + 120)).toContain('updates.reopened_at = new Date().toISOString()')
  })
})
