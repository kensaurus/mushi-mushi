/**
 * lib/pipeline.ts: the one-line result of a bulk action, the age label, the
 * queue-merge mapping of skipped fixes, and chunked pipeline actions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ posts: [] as Array<{ path: string; body: unknown }>, respond: (_p: string): unknown => ({ ok: true }) }))
vi.mock('./supabase', () => ({
  apiFetch: async (path: string, opts: { body?: string } = {}) => {
    state.posts.push({ path, body: opts.body ? JSON.parse(opts.body) : null })
    return state.respond(path)
  },
}))

import { ageLabel, deployIntakeWarning, openerSummary, outcomeSummary, runPipelineAction, type DispatcherStatus } from './pipeline'

beforeEach(() => {
  state.posts = []
})

describe('pipeline helpers', () => {
  it('outcomeSummary: one message, all done, or the first refusal', () => {
    expect(outcomeSummary([{ id: 'a', ok: true, message: 'Closed.' }])).toBe('Closed.')
    expect(outcomeSummary([{ id: 'a', ok: true, message: 'x' }, { id: 'b', ok: true, message: 'x' }])).toBe('2 done.')
    expect(outcomeSummary([{ id: 'a', ok: true, message: 'x' }, { id: 'b', ok: false, message: 'Not in the merge queue.' }])).toBe('1 done · 1 not: Not in the merge queue.')
    expect(outcomeSummary([{ id: 'b', ok: false, message: 'GitHub refused.' }])).toBe('GitHub refused.')
  })

  it('deployIntakeWarning: 14 days of silence says why and how to send deploy.completed', () => {
    const now = Date.parse('2026-10-29T00:00:00Z')
    const day = 24 * 3600_000
    expect(deployIntakeWarning(null, now)).toContain('no deploy recorded in 14 days')
    expect(deployIntakeWarning(null, now)).toContain('"type":"deploy.completed"')
    expect(deployIntakeWarning({ at: new Date(now - 14 * day).toISOString() }, now)).toContain('Too old (14 days)')
    expect(deployIntakeWarning({ at: new Date(now - 13 * day).toISOString() }, now)).toBeNull()
  })

  it('ageLabel: minutes, hours, then days', () => {
    const now = Date.parse('2026-10-26T12:00:00Z')
    expect(ageLabel('2026-10-26T11:45:00Z', now)).toBe('15 min')
    expect(ageLabel('2026-10-26T02:00:00Z', now)).toBe('10 h')
    expect(ageLabel('2026-10-23T12:00:00Z', now)).toBe('3 d')
    expect(ageLabel(null, now)).toBe('')
  })

  it('queue_merge maps skipped fixes to their reasons', async () => {
    state.respond = () => ({ ok: true, data: { queued: 1, skipped: [{ fixId: 'b', reason: 'Already merged.' }] } })
    const out = await runPipelineAction('queue_merge', ['a', 'b'])
    expect(state.posts).toEqual([{ path: '/v1/admin/merge-queue', body: { fixIds: ['a', 'b'] } }])
    expect(out).toEqual([
      { id: 'a', ok: true, message: 'Queued to merge.' },
      { id: 'b', ok: false, message: 'Already merged.' },
    ])
  })

  it('pipeline actions go in chunks of 10 and a failed request marks each PR', async () => {
    state.respond = () => ({ ok: false, error: { code: 'X', message: 'Server down.' } })
    const ids = Array.from({ length: 30 }, (_, i) => `f${i}`)
    const out = await runPipelineAction('update_branch', ids)
    expect(state.posts.map((p) => (p.body as { fixIds: string[] }).fixIds.length)).toEqual([10, 10, 10])
    expect(out).toHaveLength(30)
    expect(out.every((r) => !r.ok && r.message === 'Server down.')).toBe(true)
  })

  it('openerSummary counts apps by who opened a fix in 24 h', () => {
    const d = (server: number, local: number) =>
      ({ server: { dispatches24h: server }, local: { runs24h: local } }) as unknown as DispatcherStatus
    expect(openerSummary([d(0, 3), d(2, 0), d(0, 0), d(1, 1)])).toEqual({ server: 2, local: 2, nobody: 1 })
  })
})
