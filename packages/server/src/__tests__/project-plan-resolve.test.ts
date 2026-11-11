/**
 * `resolveProjectPlan` (quota.ts): the one project → plan resolution the
 * codebase index cap shares with the diagnosis gate (gap #16b). Since
 * 2026-11-11 the plan is the TEAM's (_shared/org-billing.ts): the app maps to
 * its organization, and the organization's live subscription decides,
 * whichever app it was bought from. A complimentary organization's plan
 * applies; a read error throws instead of silently meaning "free".
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/plans.ts', () => ({
  getPlan: async (id: string | null) => ({ id: id ?? 'free_cloud', feature_flags: {} }),
}))

import { resolveProjectPlan } from '../../supabase/functions/_shared/quota.ts'

function fakeDb(rows: { sub?: unknown; project?: unknown; subError?: string; projectError?: string }) {
  const subFilters: Array<[string, unknown]> = []
  const q = (result: { data: unknown; error: { message: string } | null }, filters?: Array<[string, unknown]>) => {
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters?.push([col, val])
        return chain
      },
      in: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => result,
    }
    return chain
  }
  const db = {
    from: (table: string) =>
      table === 'billing_subscriptions'
        ? q({ data: rows.sub ?? null, error: rows.subError ? { message: rows.subError } : null }, subFilters)
        : q({ data: rows.project ?? null, error: rows.projectError ? { message: rows.projectError } : null }),
  } as never
  return { db, subFilters }
}

const PID = '1000000a-0000-4000-8000-000000000000'
const stripeTeam = (plan_id = 'free_cloud') => ({ organization_id: 'org-1', organizations: { billing_mode: 'stripe', plan_id } })

describe('resolveProjectPlan (team plan)', () => {
  it("uses the team's live subscription, read by organization", async () => {
    const { db, subFilters } = fakeDb({ project: stripeTeam(), sub: { status: 'active', plan_id: 'pro' } })
    expect((await resolveProjectPlan(db, PID)).id).toBe('pro')
    expect(subFilters).toContainEqual(['organization_id', 'org-1'])
    expect(subFilters.some(([c]) => c === 'project_id')).toBe(false)
  })
  it('falls back to organizations.plan_id when the team has no live subscription', async () => {
    expect((await resolveProjectPlan(fakeDb({ project: stripeTeam('free_cloud') }).db, PID)).id).toBe('free_cloud')
    expect((await resolveProjectPlan(fakeDb({ project: stripeTeam('indie') }).db, PID)).id).toBe('indie')
  })
  it("gives a complimentary org its plan", async () => {
    const comp = { organization_id: 'org-c', organizations: { billing_mode: 'complimentary', plan_id: 'enterprise' } }
    expect((await resolveProjectPlan(fakeDb({ project: comp }).db, PID)).id).toBe('enterprise')
  })
  it('is Free for an app that cannot be found', async () => {
    expect((await resolveProjectPlan(fakeDb({}).db, PID)).id).toBe('free_cloud')
  })
  it('throws on a read error rather than guessing free', async () => {
    await expect(resolveProjectPlan(fakeDb({ project: stripeTeam(), subError: 'down' }).db, PID)).rejects.toThrow(/billing_subscriptions/)
    await expect(resolveProjectPlan(fakeDb({ projectError: 'down' }).db, PID)).rejects.toThrow(/projects/)
  })
})
