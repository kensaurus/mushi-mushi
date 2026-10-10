/**
 * FILE: apps/admin/src/lib/salesContact.ts
 * PURPOSE: Enterprise is arranged with our team, never bought through
 *          Checkout (owner decision 2026-10-10). One rule and one address
 *          so every billing surface says "Contact us" the same way.
 */

/** docs/adr/0015 — the product inbox. */
export const SALES_EMAIL = 'kensaurus@gmail.com'

export const ENTERPRISE_MAILTO = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Mushi Enterprise inquiry')}`

/** Mirrors isSalesLedPlan in packages/server/supabase/functions/_shared/billing-rules.ts. */
export function isSalesLedPlan(plan: { id: string; is_self_serve?: boolean }): boolean {
  return plan.id === 'enterprise' || plan.is_self_serve === false
}
