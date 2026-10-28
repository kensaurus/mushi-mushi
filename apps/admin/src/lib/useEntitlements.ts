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
  | 'inventory_v2'
  | 'rewards_program'
  | 'rewards_monetary'
  | 'marketplace_publish'

export interface UpgradeTarget {
  id: string
  display_name: string
  monthly_price_usd: number
  /** False for a plan arranged with sales (Enterprise). */
  is_self_serve?: boolean
}

interface EntitlementResponse {
  planId: string
  planName: string
  projectId?: string
  organizationId?: string | null
  featureFlags: Partial<Record<FeatureFlag, boolean>>
  gatedRoutes: Array<{ prefix: string; flag: FeatureFlag; allowed: boolean; except?: string[] }>
  isSuperAdmin: boolean
  hasProject: boolean
  userEmail?: string | null
  /** Mushi operator (company staff) — unlocks /growth and other internal dashboards. */
  operator?: boolean
  /** Caller's role on the active project; null when unknown. */
  projectRole?: 'owner' | 'admin' | 'member' | 'viewer' | null
}

export interface UseEntitlementsResult {
  planId: string
  planName: string
  isSuperAdmin: boolean
  /** True for Mushi operators (internal growth / company dashboards). Defaults false. */
  isOperator: boolean
  hasProject: boolean
  /** Caller's role on the active project; null while loading or unknown. */
  projectRole: 'owner' | 'admin' | 'member' | 'viewer' | null
  /**
   * False only for a known viewer. The API refuses viewer writes; an unknown
   * role leaves controls on and lets the API decide.
   */
  canEditProject: boolean
  /** Returns true when the caller's plan grants this feature. */
  has: (flag: FeatureFlag) => boolean
  loading: boolean
  error: string | null
  reload: () => void
}

const FALLBACK: UseEntitlementsResult['has'] = () => false

/**
 * Your own AI, Firecrawl and Browserbase keys work on every plan, Free
 * included, since 2026-10-28 (docs/plan-pricing.md). The key panels lock only
 * when the plan answered and explicitly lacks `byok`; a failed or pending
 * entitlements read never puts an upgrade prompt in front of a Free user.
 */
export function isByokLocked(e: Pick<UseEntitlementsResult, 'loading' | 'error' | 'has'>): boolean {
  return !e.loading && !e.error && !e.has('byok')
}

export function useEntitlements(): UseEntitlementsResult {
  const { data, loading, error, reload } =
    usePageData<EntitlementResponse>('/v1/admin/entitlements')

  return useMemo(() => {
    if (!data) {
      return {
        planId: 'free_cloud',
        planName: 'Free',
        isSuperAdmin: false,
        isOperator: false,
        hasProject: false,
        projectRole: null,
        canEditProject: true,
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
      isOperator: Boolean(data.operator),
      hasProject: Boolean(data.hasProject),
      projectRole: data.projectRole ?? null,
      canEditProject: data.projectRole !== 'viewer',
      has: (flag) => data.featureFlags?.[flag] === true,
      loading,
      error,
      reload,
    }
  }, [data, loading, error, reload])
}
