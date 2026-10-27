/**
 * FILE: apps/admin/src/components/LockedHubView.tsx
 * PURPOSE: A hub view the plan does not include (Single sign-on, Compliance,
 *          …) says so: "Available on <plan>" with a link to the plans. Before,
 *          `/team?view=sso` silently rendered Members and the palette entry
 *          looked broken (console journeys 2026-10-27).
 */

import { PageFirstStep } from './ui'
import { usePageData } from '../lib/usePageData'
import type { BillingResponse, PlanCatalog } from './billing/types'
import type { HubView } from '../lib/pageHubs'

/** The plans tab of Billing, a view of Team (`/billing` redirects there). */
const PLANS_HREF = '/team?view=billing&tab=plans'

/** The cheapest active plan that includes the flag, by catalog order. */
function cheapestPlanWith(plans: readonly PlanCatalog[] | undefined, flag: string): PlanCatalog | null {
  return (
    [...(plans ?? [])]
      .filter((p) => p.active !== false && p.feature_flags?.[flag] === true)
      .sort((a, b) => a.position - b.position || a.monthly_price_usd - b.monthly_price_usd)[0] ?? null
  )
}

export function LockedHubView({ view, currentPlan }: { view: HubView; currentPlan: string }) {
  const billing = usePageData<BillingResponse>('/v1/admin/billing')
  const plan = view.requiresFeature ? cheapestPlanWith(billing.data?.plans, view.requiresFeature) : null
  const planName = plan?.display_name ?? 'a higher plan'
  return (
    <div data-testid="locked-hub-view">
      <PageFirstStep
        title={`${view.label} is available on ${planName}`}
        sentence={`You are on ${currentPlan}. ${plan ? `${plan.display_name} includes ${view.label.toLowerCase()}.` : 'See which plan includes it.'}`}
        action={{ label: 'See plans', to: PLANS_HREF }}
        marksPageEmpty={false}
        data-testid="locked-hub-view-card"
      />
    </div>
  )
}
