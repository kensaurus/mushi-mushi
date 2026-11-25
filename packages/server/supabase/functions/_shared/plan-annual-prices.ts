/**
 * FILE: packages/server/supabase/functions/_shared/plan-annual-prices.ts
 * PURPOSE: The annual price of each paid plan, read from the Stripe Price
 *          object checkout actually charges (STRIPE_PRICE_INDIE_ANNUAL /
 *          STRIPE_PRICE_PRO_ANNUAL, the same env billing-rules.ts uses).
 *
 * The console used to compute it as monthly × 12 × (1 − 17%) and rounded the
 * monthly figure, so it showed $288 / $792 a year while Stripe charged $290 /
 * $790. One source now: the Price object. A price that cannot be read, is
 * not USD, or is not a one-year recurring price is left out (null), and the
 * console says the annual price is unavailable instead of guessing.
 */

import { retrievePrice, stripeFromEnv, type StripeConfig, type StripePrice } from './stripe.ts'

const ANNUAL_PRICE_ENV: Record<string, string> = {
  indie: 'STRIPE_PRICE_INDIE_ANNUAL',
  pro: 'STRIPE_PRICE_PRO_ANNUAL',
}

/** USD a year for one Stripe Price, or null when it is not a one-year USD price. Pure. */
export function annualUsdFromPrice(p: StripePrice | null | undefined): number | null {
  if (!p || !p.active || p.currency !== 'usd' || p.unit_amount == null) return null
  if (p.recurring?.interval !== 'year' || p.recurring.interval_count !== 1) return null
  return p.unit_amount / 100
}

/** Whole-percent saving of the annual price over twelve monthly payments, or null. Pure. */
export function annualDiscountPct(monthlyUsd: number, annualUsd: number | null): number | null {
  if (annualUsd == null || !(monthlyUsd > 0)) return null
  const pct = Math.round((1 - annualUsd / (monthlyUsd * 12)) * 100)
  return pct > 0 ? pct : null
}

const TTL_MS = 60 * 60_000
let cache: { at: number; prices: Record<string, number | null> } | null = null

/** planId → annual USD (or null), cached for an hour per isolate. Never throws. */
export async function annualPricesByPlan(
  deps: { cfg?: StripeConfig; env?: (k: string) => string | undefined; retrieve?: typeof retrievePrice; now?: number } = {},
): Promise<Record<string, number | null>> {
  const now = deps.now ?? Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.prices
  const env = deps.env ?? ((k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k))
  let cfg: StripeConfig
  try {
    cfg = deps.cfg ?? stripeFromEnv()
  } catch {
    return {}
  }
  const retrieve = deps.retrieve ?? retrievePrice
  const prices: Record<string, number | null> = {}
  if (!cfg.secretKey) return prices
  let failed = false
  await Promise.all(
    Object.entries(ANNUAL_PRICE_ENV).map(async ([planId, key]) => {
      const id = env(key)
      const price = id ? await retrieve(cfg, id).catch(() => ((failed = true), null)) : null
      prices[planId] = annualUsdFromPrice(price)
    }),
  )
  // A failed read is retried on the next request, not cached for an hour.
  if (!failed) cache = { at: now, prices }
  return prices
}

/** Tests reset the isolate cache. */
export function resetAnnualPriceCache(): void {
  cache = null
}
