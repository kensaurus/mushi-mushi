/**
 * Stripe status / tier badge tone helpers shared by billing panels.
 */

import { CHIP_TONE } from '../../lib/chipTone'

export const BILLING_STATUS_TONE: Record<string, string> = {
  active: CHIP_TONE.okSubtle,
  trialing: CHIP_TONE.brand,
  past_due: CHIP_TONE.warnSubtle,
  canceled: 'bg-surface-overlay text-fg-muted',
  unpaid: CHIP_TONE.dangerSubtle,
  free: 'bg-surface-overlay text-fg-muted',
}

export const BILLING_TIER_TONE: Record<string, string> = {
  hobby: 'bg-surface-overlay text-fg-muted',
  starter: CHIP_TONE.brand,
  pro: CHIP_TONE.okSubtle,
  enterprise: CHIP_TONE.warnSubtle,
}

export function formatBillingMoney(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountMinor / 100)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}
