/**
 * FILE: production-check-retention.test.ts
 * PURPOSE: retention-sweep deletes free Production Check reports
 *          (`production_checks`) after 90 days and keeps newer ones.
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

import { PRODUCTION_CHECK_RETENTION_DAYS, sweepProductionChecks } from '../../supabase/functions/retention-sweep/index.ts'

describe('sweepProductionChecks', () => {
  it(`deletes rows older than ${PRODUCTION_CHECK_RETENTION_DAYS} days and keeps newer ones`, async () => {
    const db = makeFakeDb({
      production_checks: [
        { id: 'old', created_at: '2026-07-29T00:00:00.000Z' },
        { id: 'edge', created_at: '2026-07-30T00:00:01.000Z' },
        { id: 'new', created_at: '2026-10-27T00:00:00.000Z' },
      ],
    })
    const out = await sweepProductionChecks(db as never, new Date('2026-10-28T00:00:00Z'))
    expect(PRODUCTION_CHECK_RETENTION_DAYS).toBe(90)
    expect(out.deleted).toBe(1)
    expect(db.table('production_checks').map((r) => r.id)).toEqual(['edge', 'new'])
  })

  it('a failed read deletes nothing', async () => {
    const db = makeFakeDb({ production_checks: [{ id: 'old', created_at: '2020-01-01T00:00:00.000Z' }] }, { failRead: () => 'timeout' })
    expect((await sweepProductionChecks(db as never, new Date('2026-10-28T00:00:00Z'))).deleted).toBe(0)
    expect(db.table('production_checks')).toHaveLength(1)
  })
})
