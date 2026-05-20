/**
 * FILE: apps/admin/src/components/projects/types.ts
 */

export type ProjectsTabId = 'overview' | 'list' | 'create'

export type ProjectsTopPriority =
  | 'no_projects'
  | 'never_ingested'
  | 'no_sdk_heartbeat'
  | 'partial_ingest'
  | 'healthy'

export interface ProjectsStats {
  projectCount: number
  activeKeyCount: number
  projectsWithReports: number
  sdkConnectedCount: number
  neverIngestedCount: number
  reportsLast24h: number
  reportsLast30d: number
  activeProjectId: string | null
  activeProjectName: string | null
  activeProjectHasReports: boolean
  activeProjectSdkConnected: boolean
  staleKeyCount: number
  topPriority: ProjectsTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_PROJECTS_STATS: ProjectsStats = {
  projectCount: 0,
  activeKeyCount: 0,
  projectsWithReports: 0,
  sdkConnectedCount: 0,
  neverIngestedCount: 0,
  reportsLast24h: 0,
  reportsLast30d: 0,
  activeProjectId: null,
  activeProjectName: null,
  activeProjectHasReports: false,
  activeProjectSdkConnected: false,
  staleKeyCount: 0,
  topPriority: 'no_projects',
  topPriorityLabel: null,
  topPriorityTo: null,
}
