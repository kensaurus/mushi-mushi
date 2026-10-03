/**
 * `resolveProjectPlan` (quota.ts): the one project → plan resolution the
 * codebase index cap shares with the diagnosis gate (gap #16b). A
 * complimentary organization's plan replaces the free plans; a read error
 * throws instead of silently meaning "free".
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/plans.ts', () => {
  const plan = (id: string) => ({ id, feature_flags: {} })
  return {
    getPlan: async (id: string | null) => plan(id ?? 'free_cloud'),
    resolvePlanFromSubscription: async (sub: { status?: string; plan_id?: string } | null) =>
      plan(sub && ['active', 'trialing', 'past_due'].includes(sub.status ?? '') ? (sub.plan_id ?? 'free_cloud') : 'free_cloud'),
  }
})

import { planFromProjectRows, resolveProjectPlan } from '../../supabase/functions/_shared/quota.ts'

function fakeDb(rows: { sub?: unknown; project?: unknown; subError?: string; projectError?: string }) {
  const q = (result: { data: unknown; error: { message: string } | null }) => {
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => result,
    }
    return chain
  }
  return {
    from: (table: string) =>
      table === 'billing_subscriptions'
        ? q({ data: rows.sub ?? null, error: rows.subError ? { message: rows.subError } : null })
        : q({ data: rows.project ?? null, error: rows.projectError ? { message: rows.projectError } : null }),
  } as never
}

const PID = '1000000a-0000-4000-8000-000000000000'

describe('resolveProjectPlan', () => {
  it('uses the active subscription', async () => {
    expect((await resolveProjectPlan(fakeDb({ sub: { status: 'active', plan_id: 'pro' } }), PID)).id).toBe('pro')
  })
  it('falls back to free without one', async () => {
    expect((await resolveProjectPlan(fakeDb({ project: { organizations: { billing_mode: 'stripe', plan_id: 'pro' } } }), PID)).id).toBe('free_cloud')
  })
  it("gives a complimentary org its plan over the free plans", async () => {
    expect((await resolveProjectPlan(fakeDb({ project: { organizations: { billing_mode: 'complimentary', plan_id: 'enterprise' } } }), PID)).id).toBe('enterprise')
  })
  it('throws on a read error rather than guessing free', async () => {
    await expect(resolveProjectPlan(fakeDb({ subError: 'down' }), PID)).rejects.toThrow(/billing_subscriptions/)
    await expect(resolveProjectPlan(fakeDb({ projectError: 'down' }), PID)).rejects.toThrow(/projects/)
  })
})

describe('planFromProjectRows keeps the ingest gate rule', () => {
  it('by default a comp org only replaces Hobby, as checkIngestQuota always did', async () => {
    const comp = { organizations: { billing_mode: 'complimentary', plan_id: 'pro' } }
    expect((await planFromProjectRows(null, comp)).id).toBe('pro')
    // A sub that resolved to free_cloud stays free for the ingest gate…
    expect((await planFromProjectRows({ status: 'canceled', plan_id: 'pro' }, comp)).id).toBe('free_cloud')
    // …and the diagnosis/index rule lifts it.
    expect((await planFromProjectRows({ status: 'canceled', plan_id: 'pro' }, comp, ['free_cloud', 'hobby'])).id).toBe('pro')
  })
})
