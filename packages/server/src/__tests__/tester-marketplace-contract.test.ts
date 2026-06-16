/**
 * FILE: packages/server/src/__tests__/tester-marketplace-contract.test.ts
 * PURPOSE: Source-level guards for Mushi Bounties security + payout contracts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const API_ROOT = resolve(__dirname, '../../supabase/functions')
const HELPERS = readFileSync(resolve(API_ROOT, '_shared/tester-marketplace-helpers.ts'), 'utf8')
const MARKETPLACE = readFileSync(resolve(API_ROOT, 'api/routes/tester-marketplace.ts'), 'utf8')
const PUBLISHED = readFileSync(resolve(API_ROOT, 'api/routes/published-apps.ts'), 'utf8')
const REPORTS = readFileSync(resolve(API_ROOT, 'api/routes/reports.ts'), 'utf8')

describe('tester marketplace security contract', () => {
  it('requires project access before reviewer actions', () => {
    expect(MARKETPLACE).toContain('requireSubmissionProjectAccess')
    expect(HELPERS).toContain('export async function requireSubmissionProjectAccess')
    const reviewStart = MARKETPLACE.indexOf('async function handleReview')
    expect(reviewStart).toBeGreaterThan(0)
    const reviewBody = MARKETPLACE.slice(reviewStart, reviewStart + 2500)
    expect(reviewBody).toContain('requireSubmissionProjectAccess')
  })

  it('gates withheld redemption admin routes to super-admin', () => {
    expect(MARKETPLACE).toContain('requireSuperAdmin')
    expect(MARKETPLACE).toMatch(/tester-redemptions[\s\S]{0,800}requireSuperAdmin/)
  })

  it('rejects client-supplied redemption economics', () => {
    expect(MARKETPLACE).toMatch(/points_spent|face_value_usd|sku/)
    expect(MARKETPLACE).toContain('resolveCatalogItem')
    expect(MARKETPLACE).toContain('validateRedeemRequestBody')
    expect(MARKETPLACE).toContain('clientEventId')
    expect(MARKETPLACE).toMatch(/redeem:\$\{tester\.id\}/)
  })

  it('uses server catalog and checked point deduction before fulfillment', () => {
    expect(HELPERS).toContain('export const REDEMPTION_CATALOG')
    expect(HELPERS).toContain('export async function awardPointsChecked')
    expect(MARKETPLACE).toContain('awardPointsChecked')
    expect(MARKETPLACE).toContain('checkGiftCardKycAndCap')
    expect(MARKETPLACE).toContain('check_marketplace_budget')
  })

  it('requires acceptedTerms on enroll for new testers', () => {
    expect(MARKETPLACE).toContain('acceptedTerms')
    expect(MARKETPLACE).toContain('terms_accepted_at')
    expect(MARKETPLACE).toMatch(/acceptedTerms !== true/)
  })

  it('rejects unsigned Tremendous webhooks when secret is unset', () => {
    expect(MARKETPLACE).toContain('TREMENDOUS_WEBHOOK_SECRET')
    expect(MARKETPLACE).toMatch(/TREMENDOUS_WEBHOOK_SECRET[\s\S]{0,400}(503|reject|missing)/i)
  })

  it('stamps points from bounty schedule at submit and awards on accept', () => {
    expect(HELPERS).toContain('lookupBountyPoints')
    expect(HELPERS).toContain('severityToBountyAction')
    expect(MARKETPLACE).toContain('lookupBountyPoints')
    expect(MARKETPLACE).not.toMatch(/award_tester_points[\s\S]{0,80}50[\s\S]{0,40}accept/i)
  })

  it('exposes org-scoped reviewer queue and bounty write APIs', () => {
    expect(MARKETPLACE).toContain("app.get('/v1/admin/tester-submissions'")
    expect(MARKETPLACE).toContain('accessibleProjectIds')
    expect(PUBLISHED).toContain("app.put('/v1/admin/published-apps/:projectId/bounties'")
    expect(PUBLISHED).toContain("app.put('/v1/admin/published-apps/:projectId/marketplace-settings'")
  })

  it('joins linked tester submission on report detail GET', () => {
    expect(REPORTS).toContain('tester_submission_id')
    expect(REPORTS).toContain("from('tester_submissions')")
    expect(REPORTS).toContain('tester_submission,')
    expect(REPORTS).toContain('mushi_testers!tester_submissions_tester_id_fkey')
    expect(REPORTS).toContain('published_apps!tester_submissions_app_id_fkey')
  })
})

describe('tester marketplace helper pure logic', () => {
  it('documents default severity → action mapping in helpers', () => {
    expect(HELPERS).toContain('export function severityToBountyAction')
    expect(HELPERS).toContain('bug_critical')
    expect(HELPERS).toContain('bug_high')
  })

  it('catalog resolves known ids only', () => {
    expect(HELPERS).toContain('export function resolveCatalogItem')
    expect(HELPERS).toContain('export function validateRedeemRequestBody')
    expect(HELPERS).toContain("'pro-1000'")
    expect(HELPERS).toContain("'gc-amazon-10'")
  })
})
