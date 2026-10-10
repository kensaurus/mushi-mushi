/**
 * In-app plan change and the annual-plan overage decision (2026-10-10).
 * Pure helpers from _shared/billing-rules.ts, shared by the change-plan
 * route, the Stripe webhook and the diagnosis quota gate.
 */
import { describe, expect, it } from 'vitest'
import {
  baseSubscriptionItem,
  diagnosisOverageBillable,
  intervalFromRecurring,
  overageSubscriptionItem,
  planChangeItemFields,
  planChangeItems,
  planChangeRefusal,
  selfServePlanPrices,
} from '../../supabase/functions/_shared/billing-rules.ts'

const monthlyBase = (id: string, price: string) => ({
  id,
  price: { id: price, metadata: { kind: 'base', tier: 'indie' }, recurring: { interval: 'month', interval_count: 1 } },
})
const annualBase = (id: string, price: string) => ({
  id,
  price: { id: price, metadata: { kind: 'base', tier: 'indie' }, recurring: { interval: 'year', interval_count: 1 } },
})
const overage = (id: string, price: string) => ({
  id,
  price: { id: price, metadata: { kind: 'overage' }, recurring: { interval: 'month', interval_count: 1 } },
})

describe('baseSubscriptionItem / overageSubscriptionItem', () => {
  it('finds the base item even when the overage item comes first', () => {
    const items = [overage('si_o', 'price_o'), monthlyBase('si_b', 'price_b')]
    expect(baseSubscriptionItem(items)?.id).toBe('si_b')
    expect(overageSubscriptionItem(items)?.id).toBe('si_o')
  })
  it('returns null when there is no base item', () => {
    expect(baseSubscriptionItem([overage('si_o', 'price_o')])).toBeNull()
  })
})

describe('diagnosisOverageBillable', () => {
  it('is false for a subscription without the metered overage item (annual)', () => {
    expect(diagnosisOverageBillable({ overage_subscription_item_id: null })).toBe(false)
  })
  it('is true for a monthly subscription with the overage item', () => {
    expect(diagnosisOverageBillable({ overage_subscription_item_id: 'si_o' })).toBe(true)
  })
  it('leaves the decision to the plan when there is no subscription row', () => {
    expect(diagnosisOverageBillable(null)).toBe(true)
  })
})

describe('intervalFromRecurring', () => {
  it('reads year and 12-month prices as annual', () => {
    expect(intervalFromRecurring({ interval: 'year', interval_count: 1 })).toBe('annual')
    expect(intervalFromRecurring({ interval: 'month', interval_count: 12 })).toBe('annual')
  })
  it('reads month as monthly', () => {
    expect(intervalFromRecurring({ interval: 'month', interval_count: 1 })).toBe('monthly')
    expect(intervalFromRecurring(null)).toBe('monthly')
  })
})

describe('planChangeItems', () => {
  it('Indie monthly → Pro monthly: swaps the base price, replaces the overage item, keeps the billing date', () => {
    const plan = planChangeItems({
      items: [monthlyBase('si_b', 'price_indie'), overage('si_o', 'price_indie_ovg')],
      targetBasePriceId: 'price_pro',
      targetOveragePriceId: 'price_pro_ovg',
      targetInterval: 'monthly',
    })
    expect(plan.items).toEqual([
      { id: 'si_b', price: 'price_pro', quantity: 1 },
      { id: 'si_o', deleted: true },
      { price: 'price_pro_ovg' },
    ])
    expect(plan.resetBillingAnchor).toBe(false)
  })

  it('Indie monthly → Indie annual: drops the overage item and restarts the period today', () => {
    const plan = planChangeItems({
      items: [overage('si_o', 'price_indie_ovg'), monthlyBase('si_b', 'price_indie')],
      targetBasePriceId: 'price_indie_annual',
      targetOveragePriceId: null,
      targetInterval: 'annual',
    })
    expect(plan.items).toEqual([
      { id: 'si_b', price: 'price_indie_annual', quantity: 1 },
      { id: 'si_o', deleted: true },
    ])
    expect(plan.resetBillingAnchor).toBe(true)
    expect(plan.fromInterval).toBe('monthly')
  })

  it('Pro annual → Indie monthly: adds the overage item', () => {
    const plan = planChangeItems({
      items: [annualBase('si_b', 'price_pro_annual')],
      targetBasePriceId: 'price_indie',
      targetOveragePriceId: 'price_indie_ovg',
      targetInterval: 'monthly',
    })
    expect(plan.items).toEqual([
      { id: 'si_b', price: 'price_indie', quantity: 1 },
      { price: 'price_indie_ovg' },
    ])
    expect(plan.resetBillingAnchor).toBe(true)
  })

  it('Indie annual → Pro annual: base swap only, same billing date', () => {
    const plan = planChangeItems({
      items: [annualBase('si_b', 'price_indie_annual')],
      targetBasePriceId: 'price_pro_annual',
      targetOveragePriceId: null,
      targetInterval: 'annual',
    })
    expect(plan.items).toEqual([{ id: 'si_b', price: 'price_pro_annual', quantity: 1 }])
    expect(plan.resetBillingAnchor).toBe(false)
  })

  it('leaves an overage item alone when the target uses the same overage price', () => {
    const plan = planChangeItems({
      items: [monthlyBase('si_b', 'price_a'), overage('si_o', 'price_ovg')],
      targetBasePriceId: 'price_b',
      targetOveragePriceId: 'price_ovg',
      targetInterval: 'monthly',
    })
    expect(plan.items).toEqual([{ id: 'si_b', price: 'price_b', quantity: 1 }])
  })

  it('refuses a subscription with no base item', () => {
    expect(() =>
      planChangeItems({
        items: [overage('si_o', 'price_ovg')],
        targetBasePriceId: 'price_b',
        targetOveragePriceId: null,
        targetInterval: 'annual',
      }),
    ).toThrow(/no base item/)
  })
})

describe('planChangeItemFields', () => {
  it('encodes kept, deleted and added items for the Stripe form body', () => {
    const fields = planChangeItemFields('items', [
      { id: 'si_b', price: 'price_pro', quantity: 1 },
      { id: 'si_o', deleted: true },
      { price: 'price_pro_ovg' },
    ])
    expect(fields).toEqual([
      ['items[0][id]', 'si_b'],
      ['items[0][price]', 'price_pro'],
      ['items[0][quantity]', '1'],
      ['items[1][id]', 'si_o'],
      ['items[1][deleted]', 'true'],
      ['items[2][price]', 'price_pro_ovg'],
    ])
  })
  it('nests under subscription_details for the invoice preview', () => {
    expect(planChangeItemFields('subscription_details[items]', [{ price: 'p' }])).toEqual([
      ['subscription_details[items][0][price]', 'p'],
    ])
  })
})

describe('planChangeRefusal', () => {
  const ok = {
    currentPlanId: 'indie',
    currentInterval: 'monthly' as const,
    targetPlanId: 'pro',
    targetInterval: 'monthly' as const,
  }
  it('allows active and trialing subscriptions', () => {
    expect(planChangeRefusal({ ...ok, status: 'active' })).toBeNull()
    expect(planChangeRefusal({ ...ok, status: 'trialing' })).toBeNull()
  })
  it('sends past_due / unpaid / paused to the portal first', () => {
    for (const status of ['past_due', 'unpaid', 'incomplete', 'paused']) {
      expect(planChangeRefusal({ ...ok, status })).toBe('SUBSCRIPTION_NOT_CHANGEABLE')
    }
  })
  it('refuses Enterprise and unknown plans (sales-led)', () => {
    expect(planChangeRefusal({ ...ok, status: 'active', targetPlanId: 'enterprise' })).toBe('PLAN_NOT_SELF_SERVE')
    expect(planChangeRefusal({ ...ok, status: 'active', targetPlanId: 'starter' })).toBe('PLAN_NOT_SELF_SERVE')
  })
  it('refuses a no-op and allows an interval-only change', () => {
    expect(planChangeRefusal({ ...ok, status: 'active', targetPlanId: 'indie' })).toBe('NO_CHANGE')
    expect(
      planChangeRefusal({ ...ok, status: 'active', targetPlanId: 'indie', targetInterval: 'annual' }),
    ).toBeNull()
  })
  it('refuses with no subscription', () => {
    expect(planChangeRefusal({ ...ok, status: null })).toBe('NO_SUBSCRIPTION')
  })
})

describe('selfServePlanPrices', () => {
  const env: Record<string, string> = {
    STRIPE_PRICE_INDIE_BASE: 'p_ib',
    STRIPE_PRICE_INDIE_DIAGNOSES_OVERAGE: 'p_io',
    STRIPE_PRICE_INDIE_ANNUAL: 'p_ia',
    STRIPE_PRICE_PRO_BASE_V2: 'p_pb2',
    STRIPE_PRICE_PRO_DIAGNOSES_OVERAGE: 'p_po',
    STRIPE_PRICE_PRO_ANNUAL: 'p_pa',
  }
  const get = (k: string) => env[k]
  it('gives annual plans no overage price', () => {
    expect(selfServePlanPrices('indie', 'annual', get)).toEqual({ base: 'p_ia', overage: undefined })
    expect(selfServePlanPrices('pro', 'annual', get)).toEqual({ base: 'p_pa', overage: undefined })
  })
  it('pairs monthly base and overage prices', () => {
    expect(selfServePlanPrices('indie', 'monthly', get)).toEqual({ base: 'p_ib', overage: 'p_io' })
    expect(selfServePlanPrices('pro', 'monthly', get)).toEqual({ base: 'p_pb2', overage: 'p_po' })
  })
})
