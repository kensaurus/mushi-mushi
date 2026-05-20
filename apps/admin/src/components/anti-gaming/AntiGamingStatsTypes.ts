/**
 * FILE: apps/admin/src/components/anti-gaming/AntiGamingStatsTypes.ts
 * PURPOSE: Anti-gaming shell stats — banner + ANTI-GAMING SNAPSHOT strip.
 */

export type AntiGamingTabId = 'overview' | 'devices' | 'events'

export type AntiGamingTopPriority =
  | 'no_project'
  | 'cross_account'
  | 'flagged'
  | 'velocity'
  | 'waiting'
  | 'clean'

export interface AntiGamingStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  hasIngest: boolean
  trackedDevices: number
  flaggedDevices: number
  crossAccountDevices: number
  totalReports: number
  eventsLast24h: number
  velocityEvents24h: number
  multiAccountEvents24h: number
  manualFlags24h: number
  lastEventAt: string | null
  topPriority: AntiGamingTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_ANTI_GAMING_STATS: AntiGamingStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  hasIngest: false,
  trackedDevices: 0,
  flaggedDevices: 0,
  crossAccountDevices: 0,
  totalReports: 0,
  eventsLast24h: 0,
  velocityEvents24h: 0,
  multiAccountEvents24h: 0,
  manualFlags24h: 0,
  lastEventAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
