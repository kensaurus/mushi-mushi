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
}

export const EMPTY_DASHBOARD_STATS: DashboardStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  hasData: false,
  setupDone: false,
  requiredComplete: 0,
  requiredTotal: 4,
  openBacklog: 0,
  reports14d: 0,
  fixesInProgress: 0,
  fixesFailed: 0,
  openPrs: 0,
  llmFailures14d: 0,
  llmCalls14d: 0,
  focusStage: null,
  focusLabel: null,
  bottleneck: null,
  integrationIssues: 0,
  lastActivityAt: null,
  lastActivityKind: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: '/onboarding',
}

