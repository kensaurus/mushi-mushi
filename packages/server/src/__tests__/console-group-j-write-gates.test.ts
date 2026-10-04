/**
 * FILE: packages/server/src/__tests__/console-group-j-write-gates.test.ts
 * PURPOSE: Console QA group J — server halves of the queue, releases,
 *          feature-board and support fixes. Pure policy is unit-tested;
 *          route wiring is checked at source level (no Deno boot), the
 *          same style as content-quality-admin-safety.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STUCK_AFTER_MS, queueRetryDenial } from '../../supabase/functions/_shared/queue-retry-policy.ts'

const fnRoot = resolve(__dirname, '../../supabase/functions/api')
const read = (rel: string) => readFileSync(resolve(fnRoot, rel), 'utf8')

function routeSlice(src: string, signature: string): string {
  const start = src.indexOf(signature)
  expect(start, `${signature} should exist`).toBeGreaterThanOrEqual(0)
  const next = src.slice(start + signature.length).search(/\n {2}(app|r)\.(get|post|patch|delete)\(/)
  return next === -1 ? src.slice(start) : src.slice(start, start + signature.length + next)
}

describe('queueRetryDenial (bug 55)', () => {
  const now = Date.parse('2026-10-04T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('allows failed and dead-letter jobs', () => {
    expect(queueRetryDenial({ status: 'failed' }, now)).toBeNull()
    expect(queueRetryDenial({ status: 'dead_letter' }, now)).toBeNull()
  })

  it('refuses completed jobs (re-classifying costs money)', () => {
    expect(queueRetryDenial({ status: 'completed' }, now)).toMatch(/already finished/)
  })

  it('refuses fresh pending/running jobs but allows stuck ones', () => {
    expect(queueRetryDenial({ status: 'running', started_at: ago(60_000) }, now)).toMatch(/running right now/)
    expect(queueRetryDenial({ status: 'running', started_at: ago(STUCK_AFTER_MS + 1) }, now)).toBeNull()
    expect(queueRetryDenial({ status: 'pending', scheduled_at: ago(60_000) }, now)).toMatch(/waiting/)
    expect(queueRetryDenial({ status: 'pending', created_at: ago(STUCK_AFTER_MS + 1) }, now)).toBeNull()
  })

  it('refuses a running job with no start time', () => {
    expect(queueRetryDenial({ status: 'running', started_at: null }, now)).not.toBeNull()
  })
})

describe('queue retry route', () => {
  const body = routeSlice(read('routes/queue.ts'), "app.post('/v1/admin/queue/:id/retry'")
  it('checks the policy and viewer role before resetting the job', () => {
    const update = body.indexOf(".from('processing_queue')\n      .update(")
    const fallbackUpdate = update === -1 ? body.search(/\.from\('processing_queue'\)\s*\.update\(/) : update
    expect(body.indexOf('queueRetryDenial(')).toBeGreaterThan(0)
    expect(body.indexOf('denyViewerWrite(')).toBeGreaterThan(0)
    expect(fallbackUpdate).toBeGreaterThan(body.indexOf('queueRetryDenial('))
    expect(body).toMatch(/NOT_RETRYABLE/)
  })
})

describe('releases routes', () => {
  const src = read('routes/releases.ts')

  it.each([
    ["app.post('/v1/admin/releases/draft'", 'draft releases'],
    ["app.patch('/v1/admin/releases/:id'", 'edit releases'],
    ["app.delete('/v1/admin/releases/:id'", 'delete release drafts'],
    ["app.post('/v1/admin/releases/:id/publish'", 'publish releases'],
  ])('%s refuses viewers', (sig, action) => {
    expect(routeSlice(src, sig)).toContain(`denyViewerWrite(c, `)
    expect(routeSlice(src, sig)).toContain(action)
  })

  it('publish keeps the delivery summary at the top level (CLI reads it)', () => {
    const publish = routeSlice(src, "app.post('/v1/admin/releases/:id/publish'")
    expect(publish).toMatch(/delivery: published\.delivery/)
    expect(publish).toMatch(/PUBLISHED_WITH_ERRORS/)
  })

  it('never sends raw database or zod errors to the console', () => {
    expect(src).not.toMatch(/error: error\.message \}/)
    expect(src).not.toMatch(/error: body\.error\.flatten\(\)/)
    expect(src).not.toMatch(/error: published\.error,/)
  })
})

describe('feature board', () => {
  const src = read('routes/feature-board.ts')
  const ship = routeSlice(src, "r.post('/:id/ship'")

  it('refuses viewers before changing the ticket (bug 200)', () => {
    expect(ship.indexOf('denyViewerWrite(')).toBeGreaterThan(0)
    expect(ship.indexOf('denyViewerWrite(')).toBeLessThan(ship.indexOf(".update({"))
  })

  it('refuses cancelled requests (bug 312)', () => {
    expect(ship).toMatch(/ticket\.status === 'cancelled'/)
  })

  it('never falls back to the platform operator webhook (bug 201)', () => {
    expect(ship).not.toMatch(/Deno\.env\.get\('OPERATOR_SLACK_WEBHOOK_URL'\)/)
    expect(ship).not.toMatch(/Deno\.env\.get\('OPERATOR_DISCORD_WEBHOOK_URL'\)/)
  })

  it('tells the console whether the caller may ship', () => {
    expect(routeSlice(src, "r.get('/'")).toMatch(/can_ship: canShip/)
  })
})

describe('requireProjectAccess envelope (bug 211)', () => {
  const src = read('middleware/project.ts')
  it('every refusal carries ok: false so the console reads it as an error', () => {
    const refusals = src.match(/c\.json\(\{[^\n]*\}, 40[13]\)/g) ?? []
    expect(refusals.length).toBe(3)
    for (const r of refusals) expect(r).toContain('ok: false')
  })
})

describe('super-admin user detail (bug 53)', () => {
  const src = read('routes/modernization-health-super.ts')
  const detail = routeSlice(src, "app.get('/v1/super-admin/users/:id'")
  it('selects no dropped column and reports a failed read', () => {
    expect(detail).not.toMatch(/'id, name, slug, created_at, plan_tier, data_region'/)
    expect(detail).toMatch(/data_residency_region/)
    expect(detail).toMatch(/projectsErr/)
  })

  it('entitlements expose the caller project role for UI write gates', () => {
    expect(routeSlice(src, "app.get('/v1/admin/entitlements'")).toMatch(/projectRole,/)
  })
})

describe('support tickets list (bug 311)', () => {
  const list = routeSlice(read('routes/admin-ops.ts'), "app.get('/v1/admin/support/tickets'")
  it('pages and filters active tickets on the server', () => {
    expect(list).toMatch(/\.range\(page \* limit/)
    expect(list).toMatch(/activeOnly/)
    expect(list).toMatch(/total: count/)
  })
})
