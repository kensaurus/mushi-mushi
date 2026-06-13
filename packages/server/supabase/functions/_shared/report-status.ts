/**
 * Canonical report status vocabulary + translation between CLI (/v1/sync)
 * and admin/MCP (/v1/admin) aliases.
 */

export const CANONICAL_REPORT_STATUSES = [
  'new',
  'pending',
  'submitted',
  'queued',
  'classified',
  'grouped',
  'fixing',
  'fixed',
  'dismissed',
  'triaged',
  'in_progress',
  'resolved',
  'verified',
  'reopened',
] as const

export type CanonicalReportStatus = (typeof CANONICAL_REPORT_STATUSES)[number]

/** CLI / sync route aliases -> canonical */
const SYNC_TO_CANONICAL: Record<string, CanonicalReportStatus> = {
  new: 'new',
  triaged: 'triaged',
  in_progress: 'in_progress',
  resolved: 'resolved',
  dismissed: 'dismissed',
}

/** Admin / MCP aliases -> canonical */
const ADMIN_TO_CANONICAL: Record<string, CanonicalReportStatus> = {
  pending: 'pending',
  classified: 'classified',
  grouped: 'grouped',
  fixing: 'fixing',
  fixed: 'fixed',
  dismissed: 'dismissed',
  new: 'new',
  triaged: 'triaged',
  in_progress: 'in_progress',
  resolved: 'resolved',
  verified: 'verified',
  reopened: 'reopened',
}

export function normalizeSyncStatus(
  status: string | undefined,
): CanonicalReportStatus | undefined {
  if (!status) return undefined
  return SYNC_TO_CANONICAL[status] ?? (status as CanonicalReportStatus)
}

export function normalizeAdminStatus(
  status: string | undefined,
): CanonicalReportStatus | undefined {
  if (!status) return undefined
  const mapped = ADMIN_TO_CANONICAL[status]
  if (mapped) return mapped
  if ((CANONICAL_REPORT_STATUSES as readonly string[]).includes(status)) {
    return status as CanonicalReportStatus
  }
  return undefined
}

/** resolved (CLI) and fixed (admin) are equivalent for reporter notifications. */
export function isReporterFixedStatus(status: string | null | undefined): boolean {
  return status === 'fixed' || status === 'resolved'
}
