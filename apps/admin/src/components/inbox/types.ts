/**
 * FILE: apps/admin/src/components/inbox/types.ts
 * PURPOSE: Inbox shell stats — banner + KPI strip (separate from dashboard payload).
 */

export type InboxTabId = 'overview' | 'actions' | 'stages' | 'activity'

export interface InboxStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  setupDone: boolean
  requiredComplete: number
  requiredTotal: number
  openActions: number
  clearStages: number
  totalSurfaces: number
  criticalReports14d: number
  openBacklog: number
  failedFixes14d: number
  integrationRed: number
  integrationAmber: number
  judgeStale: boolean
  judgeStaleHours: number | null
  topPriorityTitle: string | null
  topPriorityStage: string | null
  topPriorityTo: string | null
  topPriority:
    | 'no_project'
    | 'setup'
    | 'actions'
    | 'clear'
  topPriorityLabel: string | null
  nextStepTo: string | null
  openPlan: boolean
  openDo: boolean
  openCheck: boolean
  openAct: boolean
  openOps: boolean
  lastActivityAt: string | null
  lastActivityKind: string | null
}

export const EMPTY_INBOX_STATS: InboxStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  setupDone: false,
  requiredComplete: 0,
  requiredTotal: 4,
  openActions: 0,
  clearStages: 5,
  totalSurfaces: 5,
  criticalReports14d: 0,
  openBacklog: 0,
  failedFixes14d: 0,
  integrationRed: 0,
  integrationAmber: 0,
  judgeStale: false,
  judgeStaleHours: null,
  topPriorityTitle: null,
  topPriorityStage: null,
  topPriorityTo: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  nextStepTo: '/onboarding',
  openPlan: false,
  openDo: false,
  openCheck: false,
  openAct: false,
  openOps: false,
  lastActivityAt: null,
  lastActivityKind: null,
}
