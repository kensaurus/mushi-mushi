/**
 * FILE: apps/admin/src/lib/billingModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Billing page.
 */

import { useAdminMode } from './mode'
import type { BillingStats, BillingTabId } from '../components/billing/types'

export interface BillingUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideBillingSnapshot: boolean
}

export function useBillingUx(): BillingUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideBillingSnapshot: isQuickstart,
  }
}

/** Quick mode: land on the tab that matches billing posture. */
export function resolveQuickBillingTab(stats: BillingStats): BillingTabId {
  if (stats.projectCount === 0) return 'overview'
  if (
    stats.pastDueProjects > 0 ||
    stats.unpaidProjects > 0 ||
    stats.overQuota ||
    (stats.hasStripeCustomer && !stats.paymentOk)
  ) {
    return 'overview'
  }
  if (stats.approachingQuota) return 'plans'
  if (stats.cancelAtPeriodEnd) return 'overview'
  return 'overview'
}
