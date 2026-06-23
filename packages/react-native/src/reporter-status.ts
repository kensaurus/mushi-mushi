/**
 * FILE: reporter-status.ts
 * PURPOSE: Reporter-facing status labels for the RN inbox (parity with web widget).
 */

/** Compact status copy for inbox list rows. */
export function reporterStatusShort(status: string): string {
  switch (status) {
    case 'new':
    case 'queued':
    case 'pending':
    case 'submitted':
      return 'Received'
    case 'classified':
    case 'triaged':
    case 'grouped':
    case 'dispatched':
      return 'In review'
    case 'fixing':
      return 'Fixing'
    case 'fixed':
    case 'resolved':
    case 'completed':
      return 'Fixed'
    case 'dismissed':
      return 'Closed'
    default:
      return status.replace(/_/g, ' ').slice(0, 16)
  }
}
