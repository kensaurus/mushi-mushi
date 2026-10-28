/**
 * @vitest-environment jsdom
 */

/**
 * The plans table follows the 2026-10-28 catalog (docs/plan-pricing.md):
 * apps first, diagnoses as the one meter, no report quota or per-report
 * price, Builder marked popular, Enterprise with its starting price, and the
 * fit check reads apps and diagnoses.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tracked = vi.hoisted(() => [] as Array<[string, unknown]>)
vi.mock('../../lib/track', () => ({ trackAdHoc: (name: string, props: unknown) => tracked.push([name, props]) }))

import { PlanComparisonTable, planFit, planPriceLabel } from './PlanComparisonTable'
import { PAID_PLAN_IDS } from '../../lib/useActivePlan'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base = { is_self_serve: true, active: true, feature_flags: {} as Record<string, unknown> }
const PLANS = [
  { ...base, id: 'free_cloud', display_name: 'Free', position: 10, monthly_price_usd: 0, max_projects: 1, included_diagnoses_per_month: 100, overage_unit_amount_decimal_diagnoses: null, retention_days: 14, seat_limit: 1, feature_flags: { byok: true } },
  { ...base, id: 'indie', display_name: 'Builder', position: 11, monthly_price_usd: 29, max_projects: 3, included_diagnoses_per_month: 1000, overage_unit_amount_decimal_diagnoses: 0.03, retention_days: 90, seat_limit: 1 },
  { ...base, id: 'pro', display_name: 'Studio', position: 12, monthly_price_usd: 79, max_projects: 10, included_diagnoses_per_month: 5000, overage_unit_amount_decimal_diagnoses: 0.02, retention_days: 180, seat_limit: 5, feature_flags: { teams: true } },
  { ...base, id: 'enterprise', display_name: 'Enterprise', position: 13, monthly_price_usd: 499, is_self_serve: false, max_projects: null, included_diagnoses_per_month: null, overage_unit_amount_decimal_diagnoses: null, retention_days: 365, seat_limit: null },
]

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  tracked.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(props: Partial<Parameters<typeof PlanComparisonTable>[0]> = {}) {
  act(() => {
    root.render(createElement(PlanComparisonTable, { plans: PLANS, currentPlanId: 'free_cloud', ...props }))
  })
  return container.textContent ?? ''
}

describe('PlanComparisonTable', () => {
  it('leads with apps and diagnoses, and shows no report quota or per-report price', () => {
    const text = render()
    expect(text).toContain('Apps')
    expect(text).toContain('No limit')
    expect(text).toContain('Diagnoses / month')
    expect(text).toContain('$0.03 each')
    expect(text).toContain('Stops at the limit')
    expect(text).not.toContain('Reports / month')
    expect(text).not.toContain('/ report')
    expect(text.indexOf('Apps')).toBeLessThan(text.indexOf('Diagnoses / month'))
  })

  it('marks Builder as most popular and shows where Enterprise starts', () => {
    const text = render()
    expect(text.indexOf('Most popular')).toBeGreaterThan(text.indexOf('Builder'))
    expect(text.indexOf('Most popular')).toBeLessThan(text.indexOf('Studio'))
    expect(text).toContain('From $499/mo')
    expect(planPriceLabel(PLANS[1])).toBe('$29/mo')
    expect(planPriceLabel(PLANS[0])).toBe('Free')
  })

  it('checks fit on apps and diagnoses, the worse of the two winning', () => {
    expect(planFit({ apps: 2, diagnoses: 50 }, PLANS[0]).verdict.label).toBe('Over')
    expect(planFit({ apps: 1, diagnoses: 50 }, PLANS[0]).verdict.label).toBe('Fits')
    expect(planFit({ apps: 1, diagnoses: 95 }, PLANS[0]).verdict.label).toBe('Tight')
    expect(planFit({ apps: 40, diagnoses: 9000 }, PLANS[3]).verdict.label).toBe('No cap')
    const text = render({ currentUsage: { apps: 2, diagnoses: 75 } })
    expect(text).toContain('your 2 apps and 75 diagnoses this period would fit')
    expect(text).toContain('2 / 1 apps')
  })

  it('records plan_selected when a plan button is pressed', () => {
    const onSelectPlan = vi.fn()
    render({ onSelectPlan })
    const builder = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Start Builder')!
    act(() => builder.click())
    expect(onSelectPlan).toHaveBeenCalledWith('indie')
    expect(tracked).toContainEqual(['plan_selected', { plan_id: 'indie', interval: 'monthly', surface: 'console_plans' }])
  })

  it('counts Builder (indie) as a paid plan', () => {
    expect(PAID_PLAN_IDS.has('indie')).toBe(true)
    expect(PAID_PLAN_IDS.has('free_cloud')).toBe(false)
  })
})
