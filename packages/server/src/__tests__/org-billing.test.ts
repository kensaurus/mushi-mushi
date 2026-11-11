/**
 * FILE: packages/server/src/__tests__/org-billing.test.ts
 * PURPOSE: A paid plan belongs to the TEAM (organization), not to one app
 *          (VISION.md §2.2). Found 2026-11-11: checkout, the Stripe customer
 *          and the subscription were keyed per app, so one $79 Studio
 *          checkout left every other app in the team on 100 diagnoses with a
 *          hard stop, and nothing wrote organizations.plan_id, so the seat
 *          cap read Free (1 seat) for a paying team.
 *
 * Pins:
 *   - one resolver and its precedence (complimentary → org plan; else the
 *     org's live subscription; else organizations.plan_id; else Free);
 *   - stripe-webhooks writes organizations.plan_id from the team's newest
 *     live subscription and never touches a complimentary org;
 *   - the seat cap and the app limit (max_projects) read the team's plan;
 *   - diagnoses are counted across every app in the team;
 *   - deleting the app a plan was bought from moves the billing rows.
 *
 * Route and webhook modules import Deno-only code, so their wiring is
 * checked by reading source, as neighbouring tests do.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const PLANS: Record<string, { id: string; display_name: string; seat_limit: number | null; max_projects: number | null; feature_flags: Record<string, unknown> }> = {
  free_cloud: { id: 'free_cloud', display_name: 'Free', seat_limit: 1, max_projects: 1, feature_flags: {} },
  indie: { id: 'indie', display_name: 'Builder', seat_limit: 1, max_projects: 3, feature_flags: {} },
  pro: { id: 'pro', display_name: 'Studio', seat_limit: 5, max_projects: 10, feature_flags: { teams: true } },
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/plans.ts', () => ({
  getPlan: async (id: string | null | undefined) => (id && PLANS[id]) || PLANS.free_cloud,
  listPlans: async () => Object.values(PLANS),
}))

import {
  countOrgUsage,
  moveBillingAnchors,
  orgPlanIdFromLiveSubscription,
  planIdForOrganization,
  resolveOrgPlan,
  resolveProjectBilling,
  syncOrganizationPlan,
} from '../../supabase/functions/_shared/org-billing.ts'
import { resolvePlanForScope } from '../../supabase/functions/_shared/entitlements.ts'
import { appLimitDenial } from '../../supabase/functions/_shared/plan-app-limit.ts'

// ─── A PostgREST-shaped fake that records every call ────────────────────────
type Row = Record<string, unknown>
interface Call {
  table: string
  op: 'select' | 'update' | 'insert'
  filters: Array<[string, string, unknown]>
  values?: Row
}

function fakeDb(tables: Record<string, Row[]>) {
  const calls: Call[] = []
  const matches = (row: Row, filters: Call['filters']) =>
    filters.every(([kind, col, val]) =>
      kind === 'eq'
        ? row[col] === val
        : kind === 'neq'
          ? row[col] !== val
          : kind === 'in'
            ? (val as unknown[]).includes(row[col])
            : true,
    )
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] }
    calls.push(call)
    const rows = () => (tables[table] ?? []).filter((r) => matches(r, call.filters))
    const result = () => {
      if (call.op === 'update') {
        const hit = rows()
        for (const r of hit) Object.assign(r, call.values)
        return { data: hit, error: null, count: hit.length }
      }
      const hit = rows()
      return { data: hit, error: null, count: hit.length }
    }
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (values: Row) => {
        call.op = 'update'
        call.values = values
        return chain
      },
      eq: (col: string, val: unknown) => (call.filters.push(['eq', col, val]), chain),
      neq: (col: string, val: unknown) => (call.filters.push(['neq', col, val]), chain),
      in: (col: string, val: unknown) => (call.filters.push(['in', col, val]), chain),
      gte: () => chain,
      lt: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        const r = result()
        return { data: (r.data as Row[])[0] ?? null, error: null }
      },
      then: (res: (v: unknown) => unknown) => res(result()),
    }
    return chain
  }
  return { db: { from } as never, calls, tables }
}

// ─── The one rule ───────────────────────────────────────────────────────────
describe('planIdForOrganization', () => {
  it('a complimentary team gets its own plan, whatever Stripe says', () => {
    expect(planIdForOrganization({ billingMode: 'complimentary', orgPlanId: 'pro', liveSub: null })).toBe('pro')
    expect(planIdForOrganization({ billingMode: 'complimentary', orgPlanId: 'pro', liveSub: { status: 'active', plan_id: 'indie' } })).toBe('pro')
  })
  it("a paying team's live subscription wins over organizations.plan_id", () => {
    expect(planIdForOrganization({ billingMode: 'stripe', orgPlanId: 'free_cloud', liveSub: { status: 'active', plan_id: 'pro' } })).toBe('pro')
    expect(planIdForOrganization({ billingMode: 'stripe', orgPlanId: 'free_cloud', liveSub: { status: 'past_due', plan_id: 'indie' } })).toBe('indie')
  })
  it('an ended subscription falls back to organizations.plan_id, then Free', () => {
    expect(planIdForOrganization({ billingMode: 'stripe', orgPlanId: 'free_cloud', liveSub: { status: 'canceled', plan_id: 'pro' } })).toBe('free_cloud')
    expect(planIdForOrganization({ billingMode: 'stripe', orgPlanId: null, liveSub: null })).toBe('free_cloud')
  })
})

describe('orgPlanIdFromLiveSubscription (what the webhook writes)', () => {
  it('the live plan, else Free', () => {
    expect(orgPlanIdFromLiveSubscription({ status: 'trialing', plan_id: 'pro' })).toBe('pro')
    expect(orgPlanIdFromLiveSubscription({ status: 'canceled', plan_id: 'pro' })).toBe('free_cloud')
    expect(orgPlanIdFromLiveSubscription(null)).toBe('free_cloud')
  })
})

// ─── One checkout covers every app in the team ──────────────────────────────
function studioTeam() {
  return fakeDb({
    organizations: [{ id: 'org-1', billing_mode: 'stripe', plan_id: 'free_cloud' }],
    projects: [
      { id: 'app-bought', organization_id: 'org-1', organizations: { billing_mode: 'stripe', plan_id: 'free_cloud' } },
      { id: 'app-other', organization_id: 'org-1', organizations: { billing_mode: 'stripe', plan_id: 'free_cloud' } },
    ],
    billing_subscriptions: [
      { project_id: 'app-bought', organization_id: 'org-1', status: 'active', plan_id: 'pro', stripe_subscription_id: 'sub_1' },
    ],
    billing_customers: [{ project_id: 'app-bought', organization_id: 'org-1', stripe_customer_id: 'cus_1' }],
  })
}

describe('resolveProjectBilling', () => {
  it('an app that did not buy the plan still gets the team plan', async () => {
    const { db } = studioTeam()
    const billing = await resolveProjectBilling(db, 'app-other', { includeProjectIds: true })
    expect(billing.plan.id).toBe('pro')
    expect(billing.organizationId).toBe('org-1')
    expect(billing.projectIds.sort()).toEqual(['app-bought', 'app-other'])
  })
})

describe('the seat cap after an upgrade', () => {
  it('a Studio team has 5 seats as soon as its subscription lands, even before plan_id is mirrored', async () => {
    const { db } = studioTeam()
    expect((await resolveOrgPlan(db, 'org-1')).seat_limit).toBe(5)
  })
  it('checkSeatCap and the seat summary read the team plan resolver, not organizations.plan_id', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/organizations.ts'), 'utf8')
    const fn = src.slice(src.indexOf('async function checkSeatCap'), src.indexOf('function sanitiseNote'))
    expect(fn).toContain('resolveOrgPlan(db, orgId)')
    expect(fn).not.toContain(".select('plan_id')")
    expect(src).toContain('const seatPlan = await resolveOrgPlan(db, orgId)')
  })
})

describe('max_projects (apps per plan)', () => {
  it('a Studio team may add an eighth app; on Free it may not add a second', async () => {
    const { db } = studioTeam()
    const plan = await resolvePlanForScope(db, { organizationId: 'org-1' })
    expect(appLimitDenial(plan, 7)).toBeNull()
    expect(appLimitDenial(PLANS.free_cloud, 1)?.code).toBe('PLAN_APP_LIMIT')
  })
  it('the create-app route asks the team resolver', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/projects-crud.ts'), 'utf8')
    expect(src).toContain('resolvePlanForScope(db, { organizationId })')
  })
})

describe('diagnoses are pooled per team', () => {
  it('counts every app of the team and subtracts shadow rows', async () => {
    const counts: Array<{ ids: unknown; shadow: boolean }> = []
    const db = {
      from: () => {
        let ids: unknown = null
        let shadow = false
        const q: Record<string, unknown> = {
          select: () => q,
          gte: () => q,
          lt: () => q,
          in: (_c: string, v: unknown) => ((ids = v), q),
          eq: (c: string) => ((shadow = shadow || c === 'metadata->>shadow'), q),
          then: (res: (v: unknown) => unknown) => {
            counts.push({ ids, shadow })
            return res({ count: shadow ? 4 : 2500, error: null })
          },
        }
        return q
      },
    } as never
    const r = await countOrgUsage(db, ['a', 'b', 'c'], 'diagnoses', { startIso: '2026-11-01T00:00:00Z' }, { excludeShadow: true })
    expect(r).toEqual({ count: 2496, error: null })
    expect(counts.every((c) => JSON.stringify(c.ids) === JSON.stringify(['a', 'b', 'c']))).toBe(true)
  })
})

// ─── The webhook writes the team's plan ─────────────────────────────────────
describe('syncOrganizationPlan (stripe-webhooks)', () => {
  it('writes the live plan to organizations.plan_id, guarded on billing_mode', async () => {
    const { db, calls, tables } = studioTeam()
    expect(await syncOrganizationPlan(db, 'org-1')).toBe('pro')
    expect(tables.organizations[0].plan_id).toBe('pro')
    const upd = calls.find((c) => c.table === 'organizations' && c.op === 'update')!
    expect(upd.filters).toContainEqual(['eq', 'billing_mode', 'stripe'])
  })

  it('drops the team to Free when its last live subscription ends', async () => {
    const { db, tables } = studioTeam()
    tables.organizations[0].plan_id = 'pro'
    tables.billing_subscriptions[0].status = 'canceled'
    expect(await syncOrganizationPlan(db, 'org-1')).toBe('free_cloud')
    expect(tables.organizations[0].plan_id).toBe('free_cloud')
  })

  it('a late deleted event for an old subscription does not drop a team that pays on a newer one', async () => {
    const { db, tables } = studioTeam()
    tables.billing_subscriptions.push({ project_id: 'app-other', organization_id: 'org-1', status: 'canceled', plan_id: 'indie' })
    expect(await syncOrganizationPlan(db, 'org-1')).toBe('pro')
  })

  it('never touches a complimentary organization', async () => {
    const { db, calls, tables } = fakeDb({
      organizations: [{ id: 'org-comp', billing_mode: 'complimentary', plan_id: 'pro' }],
      billing_subscriptions: [],
    })
    expect(await syncOrganizationPlan(db, 'org-comp')).toBeNull()
    expect(tables.organizations[0].plan_id).toBe('pro')
    expect(calls.some((c) => c.op === 'update')).toBe(false)
  })

  it('the webhook calls it after every subscription upsert and keys rows by the team', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/stripe-webhooks/index.ts'), 'utf8')
    const upsert = src.slice(src.indexOf('const upsertSubscription'), src.indexOf('const linkCustomerOnCheckout'))
    expect(upsert.lastIndexOf('await syncOrganizationPlan(db, organizationId)')).toBeGreaterThan(upsert.indexOf("from('billing_subscriptions').upsert("))
    expect(src).toContain("metadata?.['organization_id']")
    const link = src.slice(src.indexOf('const linkCustomerOnCheckout'), src.indexOf('const markPaymentDelinquent'))
    expect(link).toContain(".eq('organization_id', organizationId)")
    expect(link).not.toContain("onConflict: 'project_id'")
  })
})

// ─── Checkout, the customer and metering are the team's ─────────────────────
describe('checkout and metering are keyed by the team', () => {
  const adminOps = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/admin-ops.ts'), 'utf8')
  const checkout = adminOps.slice(adminOps.indexOf("app.post('/v1/admin/billing/checkout'"), adminOps.indexOf("app.post('/v1/admin/billing/portal'"))

  it('a second app in a paying team cannot open a second subscription', () => {
    const live = checkout.slice(checkout.indexOf("from('billing_subscriptions')"), checkout.indexOf('ALREADY_SUBSCRIBED'))
    expect(live).toContain(".eq('organization_id', organizationId)")
    expect(live).not.toContain("eq('project_id'")
  })

  it('reuses the team customer and stamps the team on the Stripe objects', () => {
    expect(checkout).toContain('orgCustomer(db, organizationId)')
    expect(checkout).toMatch(/createCheckoutSession\(cfg, \{[\s\S]*?organizationId,/)
    const stripe = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/stripe.ts'), 'utf8')
    expect(stripe).toContain("'subscription_data[metadata][organization_id]': args.organizationId")
  })

  it('the usage aggregator meters every app to the team customer', () => {
    const agg = readFileSync(resolve(__dirname, '../../supabase/functions/usage-aggregator/index.ts'), 'utf8')
    expect(agg).toContain(".in('organization_id', uniqueOrgIds)")
  })
})

// ─── Deleting the app a plan was bought from ────────────────────────────────
describe('moveBillingAnchors', () => {
  it('moves the subscription and customer rows to another app in the team', async () => {
    const { db, tables } = studioTeam()
    expect(await moveBillingAnchors(db, 'org-1', 'app-bought')).toBe('moved')
    expect(tables.billing_subscriptions[0].project_id).toBe('app-other')
    expect(tables.billing_customers[0].project_id).toBe('app-other')
  })

  it("refuses to orphan a paying team's plan on its last app", async () => {
    const { db, tables } = studioTeam()
    tables.projects = tables.projects.filter((p) => p.id === 'app-bought')
    expect(await moveBillingAnchors(db, 'org-1', 'app-bought')).toBe('last_app_pays')
  })

  it('an app with no billing rows has nothing to move', async () => {
    const { db } = studioTeam()
    expect(await moveBillingAnchors(db, 'org-1', 'app-other')).toBe('nothing_to_move')
  })
})
