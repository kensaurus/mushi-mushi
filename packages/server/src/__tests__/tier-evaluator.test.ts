/**
 * FILE: packages/server/src/__tests__/tier-evaluator.test.ts
 * PURPOSE: An org without reward_tiers rows falls back to DEFAULT_TIERS, whose
 *          ids are placeholders (`__free__`). end_user_points.current_tier_id
 *          is a uuid FK, so writing a placeholder failed every evaluation
 *          (Sentry MUSHI-MUSHI-SERVER-21, `invalid input syntax for type uuid`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dispatched: unknown[] = []
const updates: unknown[] = []
let tierRows: unknown[] = []
let points = { total_points: 0, current_tier_id: null as string | null }

function fakeDb() {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order']) chain[m] = () => chain
      chain.single = async () => ({ data: points, error: null })
      chain.update = (row: unknown) => {
        updates.push(row)
        return { eq: async () => ({ error: null }) }
      }
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === 'reward_tiers' ? tierRows : null, error: null }).then(resolve)
      return chain
    },
  }
}

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/reward-webhooks.ts', () => ({
  dispatchRewardWebhook: async (_db: unknown, _org: string, payload: unknown) => {
    dispatched.push(payload)
  },
}))

const { evaluateTier, isPersistedTier } = await import('../../supabase/functions/_shared/tier-evaluator.ts')

beforeEach(() => {
  dispatched.length = 0
  updates.length = 0
  tierRows = []
})

describe('evaluateTier with the fallback ladder', () => {
  it('never writes a placeholder id into the uuid column', async () => {
    points = { total_points: 10, current_tier_id: null }
    const r = await evaluateTier(fakeDb() as never, 'eu-1', 'org-1', 10)
    expect(r.tier?.slug).toBe('free')
    expect(updates).toEqual([])
  })

  it('reports a crossing once, from the points this award added', async () => {
    points = { total_points: 105, current_tier_id: null }
    const crossed = await evaluateTier(fakeDb() as never, 'eu-1', 'org-1', 10)
    expect(crossed.tierChanged).toBe(true)
    expect(dispatched).toHaveLength(1)

    points = { total_points: 115, current_tier_id: null }
    const again = await evaluateTier(fakeDb() as never, 'eu-1', 'org-1', 10)
    expect(again.tierChanged).toBe(false)
    expect(dispatched).toHaveLength(1)
    expect(updates).toEqual([])
  })
})

describe('evaluateTier with real reward_tiers rows', () => {
  it('persists the row id', async () => {
    const id = '7d0f2a3e-4b5c-4d6e-8f90-a1b2c3d4e5f6'
    tierRows = [{ id, slug: 'bronze', display_name: 'Bronze', points_threshold: 0, perks: {}, host_credit_payload: null, monetary_reward_usd: null }]
    points = { total_points: 5, current_tier_id: null }
    const r = await evaluateTier(fakeDb() as never, 'eu-1', 'org-1', 5)
    expect(r.tierChanged).toBe(true)
    expect(updates).toEqual([expect.objectContaining({ current_tier_id: id })])
  })
})

describe('isPersistedTier', () => {
  it('accepts uuids and rejects placeholders', () => {
    expect(isPersistedTier({ id: '__free__' })).toBe(false)
    expect(isPersistedTier({ id: '7d0f2a3e-4b5c-4d6e-8f90-a1b2c3d4e5f6' })).toBe(true)
  })
})
