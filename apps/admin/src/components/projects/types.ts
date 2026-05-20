/**
 * FILE: apps/admin/src/components/projects/types.ts
 */

export type ProjectsTabId = 'list' | 'create'

export interface ProjectsStats {
  projectCount: number
  activeKeyCount: number
  projectsWithReports: number
  sdkConnectedCount: number
  neverIngestedCount: number
  reportsLast24h: number
  reportsLast30d: number
  activeProjectId: string | null
  activeProjectHasReports: boolean
  activeProjectSdkConnected: boolean
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
  activeProjectHasReports: false,
  activeProjectSdkConnected: false,
}
