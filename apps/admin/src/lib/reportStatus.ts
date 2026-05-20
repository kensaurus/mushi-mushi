/**
 * Canonical report workflow statuses (admin UI + bulk API).
 * Legacy DB rows may still use triaged/resolved/queued — normalize for display and stats.
 */
export const CANONICAL_REPORT_STATUSES = [
  'new',
  'classified',
  'fixing',
  'fixed',
  'dismissed',
] as const

export type CanonicalReportStatus = (typeof CANONICAL_REPORT_STATUSES)[number]

/** Map legacy/SDK statuses onto the canonical workflow for counts and steppers. */
export function normalizeReportStatus(status: string | null | undefined): string {
  if (!status) return 'new'
  switch (status) {
    case 'triaged':
    case 'grouped':
    case 'dispatched':
      return 'classified'
    case 'resolved':
    case 'completed':
      return 'fixed'
    case 'pending':
    case 'submitted':
      return 'new'
    default:
      return status
  }
}

/** Fold legacy keys into canonical buckets for /v1/admin/stats byStatus. */
export function foldStatusCounts(
  raw: Record<string, number> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, cnt] of Object.entries(raw ?? {})) {
    const canon = normalizeReportStatus(key)
    out[canon] = (out[canon] ?? 0) + cnt
  }
  return out
}
