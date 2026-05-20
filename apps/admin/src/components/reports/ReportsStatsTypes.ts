/**
 * FILE: apps/admin/src/components/reports/ReportsStatsTypes.ts
 * PURPOSE: Reports shell stats — banner + TRIAGE SNAPSHOT strip.
 */

export type ReportsTabId = 'overview' | 'queue' | 'severity'

export type ReportsTopPriority = 'critical' | 'backlog' | 'untriaged' | 'clear' | 'waiting_ingest'

export interface ReportsStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  setupDone: boolean
  hasIngest: boolean
  totalAllTime: number
  total14d: number
  critical14d: number
  high14d: number
  newUntriaged: number
  openBacklog: number
  dismissed14d: number
  lastReportAt: string | null
  topPriority: ReportsTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_REPORTS_STATS: ReportsStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  setupDone: false,
  hasIngest: false,
  totalAllTime: 0,
  total14d: 0,
  critical14d: 0,
  high14d: 0,
  newUntriaged: 0,
  openBacklog: 0,
  dismissed14d: 0,
  lastReportAt: null,
  topPriority: 'waiting_ingest',
  topPriorityLabel: null,
  topPriorityTo: null,
}
