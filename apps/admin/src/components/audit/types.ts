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

