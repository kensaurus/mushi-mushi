/**
 * FILE: packages/server/src/__tests__/tester-plan-credit.test.ts
 * PURPOSE: Pins the plan-credit redemption fix (2026-11-11). The route read a
 *          `subscriptions` table that does not exist, so it never found a
 *          Stripe customer, skipped the credit and still marked the
 *          redemption complete: the tester lost the points and got nothing.
 *          The route module imports Deno-only code, so this reads its source.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/tester-marketplace.ts'), 'utf8')
const redeem = src.slice(src.indexOf("if (kind !== 'gift_card')"), src.indexOf("app.get('/v1/tester/wallet/history'"))

describe('plan credit redemption', () => {
  it('never reads the missing per-user subscriptions table', () => {
    expect(src).not.toMatch(/from\('subscriptions'\)/)
  })

  it('finds the customer through an organization the tester owns or administers', () => {
    const helper = src.slice(src.indexOf('export async function paidPlanCustomerFor'), src.indexOf('export async function paidPlanCustomerFor') + 1500)
    expect(helper).toContain("from('organization_members')")
    expect(helper).toContain("in('role', ['owner', 'admin'])")
    expect(helper).toContain("from('billing_subscriptions')")
    // One Stripe customer per team: looked up by the subscription's organization.
    expect(helper).toContain('orgCustomer(db, sub.organization_id)')
    expect(helper).not.toContain("eq('project_id'")
  })

  it('refunds the points and fails the redemption when there is no paid plan, before any credit', () => {
    const noPlan = redeem.indexOf("'no_paid_plan'")
    expect(noPlan).toBeGreaterThan(-1)
    expect(redeem.indexOf('refund:no-plan:')).toBeGreaterThan(noPlan)
    expect(redeem.indexOf('createCustomerBalanceCredit(stripeCfg')).toBeGreaterThan(redeem.indexOf('refund:no-plan:'))
  })

  it('marks the redemption complete only after the credit call', () => {
    expect(redeem.indexOf("status: 'complete'")).toBeGreaterThan(redeem.indexOf('createCustomerBalanceCredit(stripeCfg'))
  })
})
