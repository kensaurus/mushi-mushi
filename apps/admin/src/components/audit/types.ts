/**
 * FILE: apps/admin/src/components/audit/types.ts
 */

export type AuditTabId = 'overview' | 'log' | 'breakdown'

export interface AuditStats {
  projectId: string | null
  projectName: string | null
  auditLogEntitlement: boolean
  planId: string
  planDisplayName: string
  projectCount: number
  totalEvents: number
  events24h: number
  events7d: number
  failCount24h: number
  warnCount24h: number
  humanCount24h: number
  agentCount24h: number
  systemCount24h: number
  activeProjectEvents24h: number
  latestEventAt: string | null
  latestAction: string | null
  latestActorEmail: string | null
  topAction7d: string | null
  topAction7dCount: number
  /** Rows the top-action count was computed from (newest first, capped). */
  topAction7dSampleSize?: number
  /** Actions the failure / warning counts include (server-owned lists). */
  failActions?: string[]
  warnActions?: string[]
}

/** `?outcome=` on the log: the same action groups the banner counts. */
export type AuditOutcome = 'failure' | 'warning'

export function parseAuditOutcome(raw: string | null): AuditOutcome | null {
  return raw === 'failure' || raw === 'warning' ? raw : null
}

/**
 * Plain label for the top-action count. When the server counted only the
 * newest rows of a busier week it says so, instead of presenting a sample
 * as the week's total.
 */
export function topActionLabel(stats: Pick<AuditStats, 'topAction7dCount' | 'topAction7dSampleSize' | 'events7d'>): string {
  const n = stats.topAction7dCount
  const occurrences = `${n.toLocaleString()} occurrence${n === 1 ? '' : 's'}`
  const sample = stats.topAction7dSampleSize ?? 0
  if (sample > 0 && sample < stats.events7d) {
    return `${occurrences} in the latest ${sample.toLocaleString()} of ${stats.events7d.toLocaleString()} events this week`
  }
  return `${occurrences} this week, across your projects`
}

export const EMPTY_AUDIT_STATS: AuditStats = {
  projectId: null,
  projectName: null,
  auditLogEntitlement: false,
  planId: 'hobby',
  planDisplayName: 'Hobby',
  projectCount: 0,
  totalEvents: 0,
  events24h: 0,
  events7d: 0,
  failCount24h: 0,
  warnCount24h: 0,
  humanCount24h: 0,
  agentCount24h: 0,
  systemCount24h: 0,
  activeProjectEvents24h: 0,
  latestEventAt: null,
  latestAction: null,
  latestActorEmail: null,
  topAction7d: null,
  topAction7dCount: 0,
}

