/**
 * FILE: apps/admin/src/components/storage/types.ts
 */

export type StorageTabId = 'overview' | 'configure' | 'usage'

export type StorageHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'failing'

export interface StorageStats {
  projectId: string | null
  projectName: string | null
  planId: string
  planDisplayName: string
  projectCount: number
  configuredCount: number
  unconfiguredCount: number
  healthyCount: number
  degradedCount: number
  failingCount: number
  unknownCount: number
  neverProbedCount: number
  totalObjects: number
  activeProjectObjects: number
  activeProjectLastWrite: string | null
  activeProjectHealthStatus: StorageHealthStatus | string
  activeProjectProvider: string
  activeProjectConfigured: boolean
  lastHealthCheckAt: string | null
  latestFailureError: string | null
}

export const EMPTY_STORAGE_STATS: StorageStats = {
  projectId: null,
  projectName: null,
  planId: 'hobby',
  planDisplayName: 'Hobby',
  projectCount: 0,
  configuredCount: 0,
  unconfiguredCount: 0,
  healthyCount: 0,
  degradedCount: 0,
  failingCount: 0,
  unknownCount: 0,
  neverProbedCount: 0,
  totalObjects: 0,
  activeProjectObjects: 0,
  activeProjectLastWrite: null,
  activeProjectHealthStatus: 'unknown',
  activeProjectProvider: 'supabase',
  activeProjectConfigured: false,
  lastHealthCheckAt: null,
  latestFailureError: null,
}

