/**
 * FILE: fresh-eyes-retention.test.ts
 * PURPOSE: Fresh-eyes screenshots (ADR 0053) leave the bucket after the
 *          project's capture window, the run keeps its timeline and is not
 *          swept again, and a failed delete keeps the mark off for a retry.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({ startCronRun: async () => ({ finish: async () => {}, fail: async () => {} }) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (_n: string, h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/plans.ts', () => ({ listPlans: async () => [] }))

import { sweepFreshEyesShots } from '../../supabase/functions/retention-sweep/index.ts'

const OLD = new Date(Date.now() - 40 * 86_400_000).toISOString()
const NEW = new Date(Date.now() - 2 * 86_400_000).toISOString()
const timeline = [{ steps: [{ shot: 's1-step00.png' }, { shot: 's1-step01.png' }, { shot: null }] }]

function db(removeError: string | null = null) {
  const d = makeFakeDb({
    project_settings: [{ project_id: 'p1', ux_capture_retention_days: null }],
    ux_runs: [
      { id: 'old', project_id: 'p1', kind: 'fresh_eyes', started_at: OLD, counts: { sessions: 1 }, timeline },
      { id: 'new', project_id: 'p1', kind: 'fresh_eyes', started_at: NEW, counts: {}, timeline },
      { id: 'loop', project_id: 'p1', kind: 'loop', started_at: OLD, counts: {}, timeline: null },
    ],
  })
  const removed: string[][] = []
  ;(d as unknown as { storage: unknown }).storage = { from: () => ({ remove: async (paths: string[]) => (removed.push(paths), { error: removeError ? { message: removeError } : null }) }) }
  return { d, removed }
}

describe('sweepFreshEyesShots', () => {
  it('removes old runs’ screenshots once and keeps their timeline', async () => {
    const { d, removed } = db()
    expect(await sweepFreshEyesShots(d as never)).toEqual({ deleted: 2 })
    expect(removed).toEqual([['p1/old/fresh-eyes/s1-step00.png', 'p1/old/fresh-eyes/s1-step01.png']])
    const old = d.tables.ux_runs!.find((r) => r.id === 'old')!
    expect(old.counts).toEqual({ sessions: 1, shots_cleared: true })
    expect(old.timeline).toEqual(timeline)
    // Already cleared: the next sweep leaves it alone.
    expect(await sweepFreshEyesShots(d as never)).toEqual({ deleted: 0 })
  })

  it('keeps the mark off when the bucket refuses, so the next sweep retries', async () => {
    const { d } = db('storage down')
    expect(await sweepFreshEyesShots(d as never)).toEqual({ deleted: 0 })
    expect(d.tables.ux_runs!.find((r) => r.id === 'old')!.counts).toEqual({ sessions: 1 })
  })
})
