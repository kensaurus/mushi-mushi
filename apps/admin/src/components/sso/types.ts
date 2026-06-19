/**
 * SSO stats slice for banner + nav badges.
 */

import type { SsoTopPriority } from '../../lib/ssoExplainer'

export type { SsoTopPriority }

export interface SsoStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  ssoEntitlement: boolean
  planId: string
  planDisplayName: string
  totalConfigs: number
  registeredCount: number
  pendingCount: number
  failedCount: number
  manualRequiredCount: number
  disabledCount: number
  activeCount: number
  domainCount: number
  lastRegisteredAt: string | null
  defaultAcsUrl: string | null
  latestFailure: string | null
  latestProviderName: string | null
  topPriority: SsoTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_SSO_STATS: SsoStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  ssoEntitlement: false,
  planId: 'hobby',
  planDisplayName: 'Hobby',
  totalConfigs: 0,
  registeredCount: 0,
  pendingCount: 0,
  failedCount: 0,
  manualRequiredCount: 0,
  disabledCount: 0,
  activeCount: 0,
  domainCount: 0,
  lastRegisteredAt: null,
  defaultAcsUrl: null,
  latestFailure: null,
  latestProviderName: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
