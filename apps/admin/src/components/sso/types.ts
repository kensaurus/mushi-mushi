/**
 * FILE: apps/admin/src/components/sso/types.ts
 */

export type SsoTabId = 'overview' | 'providers' | 'setup'

export type SsoRegistrationStatus =
  | 'pending'
  | 'registered'
  | 'failed'
  | 'disabled'
  | 'manual_required'

export interface SsoStats {
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
}

export const EMPTY_SSO_STATS: SsoStats = {
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
}

export interface SsoConfig {
  id: string
  provider_type: string
  provider_name: string
  metadata_url: string | null
  entity_id: string | null
  acs_url: string | null
  is_active: boolean
  sso_provider_id: string | null
  registration_status: SsoRegistrationStatus
  registration_error: string | null
  registered_at: string | null
  domains: string[] | null
}
