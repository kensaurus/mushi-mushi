/**
 * FILE: apps/admin/src/lib/useEntitlements.ts
 * PURPOSE: One-call introspection into "what can this user do?" — backs
 *          UpgradePrompt rendering on /sso, /byok, /plugins, /intelligence
 *          and the conditional super-admin sidebar item on the Layout.
 *
 *          Reads `/v1/admin/entitlements` (Phase 1c). The endpoint is
 *          cheap (no Stripe round-trip), so this hook is safe to call
 *          from many components — the apiFetch micro-cache + dedup
 *          coalesces concurrent mounts onto one request.
 *
 *          Keep the shape narrow: only the fields the UI actually
 *          consumes. The full plan catalog lives in `useActivePlan`
 *          which reads /v1/admin/billing.
 */
import { useMemo } from 'react'
import { usePageData } from './usePageData'

export type FeatureFlag =
  | 'sso'
  | 'byok'
  | 'plugins'
  | 'intelligence_reports'
  | 'audit_log'
  | 'soc2'
  | 'self_hosted'
  | 'teams'

export interface UpgradeTarget {
  id: string
  display_name: string
  monthly_price_usd: number
}

interface EntitlementResponse {
  planId: string
  planName: string
  projectId?: string
  organizationId?: string | null
  featureFlags: Partial<Record<FeatureFlag, boolean>>
  gatedRoutes: Array<{ prefix: string; flag: FeatureFlag; allowed: boolean }>
  isSuperAdmin: boolean
  hasProject: boolean
  userEmail?: string | null
}

export interface UseEntitlementsResult {
  planId: string
  planName: string
  isSuperAdmin: boolean
  hasProject: boolean
  /** Returns true when the caller's plan grants this feature. */
  has: (flag: FeatureFlag) => boolean
  loading: boolean
  error: string | null
  reload: () => void
}

const FALLBACK: UseEntitlementsResult['has'] = () => false

export function useEntitlements(): UseEntitlementsResult {
  const { data, loading, error, reload } =
    usePageData<EntitlementResponse>('/v1/admin/entitlements')

  return useMemo(() => {
    if (!data) {
      return {
        planId: 'hobby',
        planName: 'Hobby',
        isSuperAdmin: false,
        hasProject: false,
        has: FALLBACK,
        loading,
        error,
        reload,
      }
    }
    return {
      planId: data.planId,
      planName: data.planName,
      isSuperAdmin: Boolean(data.isSuperAdmin),
      hasProject: Boolean(data.hasProject),
      has: (flag) => data.featureFlags?.[flag] === true,
      loading,
      error,
      reload,
    }
  }, [data, loading, error, reload])
}
