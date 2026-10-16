/**
 * FILE: apps/admin/src/components/dashboard/DashboardStatsTypes.ts
 * PURPOSE: Dashboard shell stats — banner + KPI strip (separate from full payload).
 */

export type DashboardTabId = 'overview' | 'loop' | 'metrics' | 'health'

export interface DashboardStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  hasData: boolean
  setupDone: boolean
  requiredComplete: number
  requiredTotal: number
  openBacklog: number
  reports14d: number
  fixesInProgress: number
  fixesFailed: number
  openPrs: number
  llmFailures14d: number
  llmCalls14d: number
  focusStage: string | null
  focusLabel: string | null
  bottleneck: string | null
  integrationIssues: number
  lastActivityAt: string | null
  lastActivityKind: string | null
  topPriority:
    | 'no_project'
    | 'setup'
    | 'backlog'
    | 'fixes_failed'
    | 'integrations'
    | 'waiting_data'
    | 'healthy'
  topPriorityLabel: string | null
  topPriorityTo: string | null
  failed_fixes_preview?: Array<{
    id: string
    report_id: string
    error_head: string | null
    report_title: string | null
  }>
}
