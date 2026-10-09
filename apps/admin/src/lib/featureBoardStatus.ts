/**
 * FILE: apps/admin/src/lib/featureBoardStatus.ts
 * PURPOSE: One definition of "shipped" and "closed" for the feature board,
 *          so the Shipped filter, its badge and the snapshot tile agree.
 *
 * Mark shipped from the board sets `status = resolved` and `shipped_at`, but
 * no release id; publishing a release sets `shipped_in_release_id`. The badge
 * counted only the release id, so board-shipped items were listed under
 * Shipped while the count stayed at 0.
 */

type FeatureStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'cancelled'

interface ShippableTicket {
  status: FeatureStatus
  shipped_in_release_id: string | null
  shipped_at?: string | null
}

export function isFeatureShipped(t: ShippableTicket): boolean {
  return t.status === 'resolved' || Boolean(t.shipped_in_release_id) || Boolean(t.shipped_at)
}

/** Cancelled, closed and shipped requests take no new votes or ship marks. */
export function isFeatureClosed(t: ShippableTicket): boolean {
  return t.status === 'cancelled' || t.status === 'closed' || isFeatureShipped(t)
}
