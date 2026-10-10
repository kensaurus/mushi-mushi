/**
 * Billing → Plans had no way to choose a plan: PlanComparisonTable renders
 * its Start / Switch buttons only when `onSelectPlan` is passed, and the page
 * never passed it (suspected-bugs entry 117). The page is too heavy to render
 * here, so the wiring is pinned in source.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'BillingPage.tsx'), 'utf8')
const table = src.slice(src.indexOf('<PlanComparisonTable'), src.indexOf('/>', src.indexOf('<PlanComparisonTable')))

describe('Billing Plans tab', () => {
  it('passes onSelectPlan into the same plan handler the Overview picker uses', () => {
    expect(table).toContain('onSelectPlan={')
    expect(table).toContain('pickPlan(activeProject.project_id, planId')
    expect(src).toMatch(/onPickPlan=\{\(projectId, planId, billingInterval\) => \{[\s\S]*?pickPlan\(projectId, planId, billingInterval\)/)
  })

  // A paying project switches in-app (a second Checkout would 409
  // ALREADY_SUBSCRIBED); a free project still goes to Checkout.
  it('sends free projects to checkout and paying projects to the change-plan dialog', () => {
    const handler = src.slice(src.indexOf('const pickPlan = useCallback'), src.indexOf('const triggerUpgrade'))
    expect(handler).toContain('if (!paying) {')
    expect(handler).toContain('void startCheckout(projectId, planId, billingInterval)')
    expect(handler).toContain('setChangeTarget(')
    expect(src).toContain('<ChangePlanDialog target={changeTarget}')
  })

  it('offers no checkout to complimentary accounts', () => {
    expect(table).toContain("activeProject.billing_mode !== 'complimentary'")
  })

  it('shows the checkout as busy while it opens', () => {
    expect(table).toContain('busy={actioning === `checkout:${activeProject?.project_id')
  })
})
