/**
 * FILE: apps/admin/src/components/portfolio/storeReviewsView.ts
 * PURPOSE: Pure view helpers for StoreReviewsPanel (gap #23). A store that
 *          failed is named in the pull summary, never folded into "0 filed".
 */

export interface StoreIntakeResult {
  status: 'ok' | 'partial' | 'failed' | 'not_connected' | 'disabled'
  filed: number
  stores: Array<{ store: string; appId: string; status: 'ok' | 'error' | 'not_connected'; fetched: number; newReviews: number; filed: number; detail: string | null }>
}

const STORE: Record<string, string> = { app_store: 'App Store', play: 'Google Play' }

export function storeLabel(store: string): string {
  return STORE[store] ?? store
}

/** The threshold option text: 1 → "1 star", 2 → "1–2 stars", 5 → "any rating". */
export function ratingLabel(maxRating: number): string {
  if (maxRating >= 5) return 'any rating'
  if (maxRating <= 1) return '1 star'
  return `1–${maxRating} stars`
}

export function pullSummary(r: StoreIntakeResult): string {
  if (r.status === 'disabled') return 'Store reviews as reports is off for this app.'
  if (r.status === 'not_connected' && r.stores.length === 0) return 'No App Store Connect or Google Play source is bound to this app.'
  const head = `${r.filed} new report${r.filed === 1 ? '' : 's'} filed.`
  const lines = r.stores.map((s) => (s.status === 'ok'
    ? `${storeLabel(s.store)}: ${s.newReviews} new review${s.newReviews === 1 ? '' : 's'}, ${s.filed} filed`
    : `${storeLabel(s.store)}: ${s.detail ?? (s.status === 'not_connected' ? 'not connected' : 'could not be read')}`))
  return [head, ...lines].join(' · ')
}
