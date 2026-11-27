/**
 * Stripe status / tier badge tone helpers shared by billing panels.
 */

import { CHIP_TONE } from '../../lib/chipTone'

export const BILLING_STATUS_TONE: Record<string, string> = {
  active: CHIP_TONE.ok,
  trialing: CHIP_TONE.brand,
  past_due: CHIP_TONE.warn,
  canceled: 'bg-surface-overlay text-fg-muted',
  unpaid: CHIP_TONE.danger,
  free: 'bg-surface-overlay text-fg-muted',
}

export const BILLING_TIER_TONE: Record<string, string> = {
  hobby: 'bg-surface-overlay text-fg-muted',
  starter: CHIP_TONE.brand,
  pro: CHIP_TONE.ok,
  enterprise: CHIP_TONE.warn,
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
