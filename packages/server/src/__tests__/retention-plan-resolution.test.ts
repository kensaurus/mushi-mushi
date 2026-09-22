/**
 * FILE: packages/server/src/__tests__/retention-plan-resolution.test.ts
 * PURPOSE: Pin the plan precedence the retention sweep uses to decide how old
 *          a report must be before it is deleted.
 *
 * Until 2026-09-21 the resolver (then inline in retention-sweep) skipped organizations.plan_id. The
 * founder's org is on `pro` (90 days) with no Stripe subscription row, so
 * every dogfood project fell through to the 7-day free window and the daily
 * sweep deleted real end-user reports: 645 all-time, 17 left platform-wide.
 * The first test below is that exact production shape.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({
  startCronRun: async () => ({ finish: async () => {}, fail: async () => {} }),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (_name: string, handler: unknown) => handler,
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))

const PLANS: Record<string, { id: string; retention_days: number }> = {
  free_cloud: { id: 'free_cloud', retention_days: 7 },
  indie: { id: 'indie', retention_days: 30 },
  pro: { id: 'pro', retention_days: 90 },
}
vi.mock('../../supabase/functions/_shared/plans.ts', () => ({
  listPlans: async () => Object.values(PLANS),
  getPlan: async (id: string | null | undefined) => (id && PLANS[id]) || PLANS.free_cloud,
  resolvePlanFromSubscription: async (sub: { status?: string; plan_id?: string | null } | null) =>
    sub && ['active', 'trialing', 'past_due'].includes(sub.status ?? '')
      ? PLANS[sub.plan_id ?? 'free_cloud'] ?? PLANS.free_cloud
      : PLANS.free_cloud,
}))

import { resolveProjectRetention } from '../../supabase/functions/_shared/retention-policy.ts'

interface World {
  policy?: { reports_retention_days: number; legal_hold: boolean } | null
  project?: { organization_id: string | null } | null
  subscriptionByOrg?: { status: string; plan_id: string } | null
  subscriptionByProject?: { status: string; plan_id: string } | null
  org?: { plan_id: string | null } | null
}

/** A PostgREST-shaped fake: every chain resolves by table + the filters it saw. */
function fakeDb(world: World) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value
          return chain
        },
        maybeSingle: async () => {
          switch (table) {
            case 'project_retention_policies':
              return { data: world.policy ?? null, error: null }
            case 'projects':
              return { data: world.project ?? null, error: null }
            case 'organizations':
              return { data: world.org ?? null, error: null }
            case 'billing_subscriptions':
              return {
                data: 'organization_id' in filters ? world.subscriptionByOrg ?? null : world.subscriptionByProject ?? null,
                error: null,
              }
            default:
              throw new Error(`unexpected table ${table}`)
          }
        },
      }
      return chain
    },
  } as unknown as Parameters<typeof resolveProjectRetention>[0]
}

describe('resolveProjectRetention', () => {
  it('a pro org with no subscription keeps reports for 90 days (the production data-loss case)', async () => {
    const r = await resolveProjectRetention(
      fakeDb({ project: { organization_id: 'org-kenji' }, org: { plan_id: 'pro' } }),
      'proj-1',
    )
    expect(r).toEqual({ retention_days: 90, plan_id: 'pro', source: 'plan', legal_hold: false })
  })

  it('an active subscription on the organization wins over the org plan_id', async () => {
    const r = await resolveProjectRetention(
      fakeDb({
        project: { organization_id: 'org-1' },
        subscriptionByOrg: { status: 'active', plan_id: 'indie' },
        org: { plan_id: 'pro' },
      }),
      'proj-1',
    )
    expect(r.retention_days).toBe(30)
    expect(r.source).toBe('plan')
  })

  it('a project with no organization still honours a project-keyed subscription', async () => {
    const r = await resolveProjectRetention(
      fakeDb({ project: { organization_id: null }, subscriptionByProject: { status: 'trialing', plan_id: 'pro' } }),
      'proj-legacy',
    )
    expect(r.retention_days).toBe(90)
  })

  it('no policy, no subscription, no org plan falls back to the free window', async () => {
    const r = await resolveProjectRetention(fakeDb({ project: { organization_id: 'org-free' }, org: { plan_id: null } }), 'p')
    expect(r).toEqual({ retention_days: 7, plan_id: 'free_cloud', source: 'fallback', legal_hold: false })
  })

  it('an explicit policy override and a legal hold still win over every plan', async () => {
    const override = await resolveProjectRetention(
      fakeDb({ policy: { reports_retention_days: 365, legal_hold: false }, org: { plan_id: 'pro' } }),
      'p',
    )
    expect(override).toMatchObject({ retention_days: 365, source: 'override' })
    const hold = await resolveProjectRetention(fakeDb({ policy: { reports_retention_days: 30, legal_hold: true } }), 'p')
    expect(hold.legal_hold).toBe(true)
  })
})
