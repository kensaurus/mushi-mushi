/**
 * FILE: apps/admin/src/components/billing/PlanBenefitsList.tsx
 * PURPOSE: Per-project "what you get on <plan>" checklist shown under the
 *          usage bar on each ProjectBillingCard. Turns opaque feature flags
 *          (`sso: true`, `byok: true`) into plain-language, scannable rows so
 *          a paid customer can answer "am I actually getting what I paid for?"
 *          without opening the plan comparison.
 */

import { InlineProof } from '../report-detail/ReportSurface'
import { seatEntitlementLabel, upgradeHintText, type UpgradePlanHint } from '../../lib/billingView'

interface FeatureFlags {
  sso?: boolean
  /** Invites and more than one seat (pricing_plans.feature_flags.teams). */
  teams?: boolean
  byok?: boolean
  plugins?: boolean
  audit_log?: boolean
  intelligence_reports?: boolean
  soc2?: boolean
  self_hosted?: boolean
  sla_hours?: number | null
}

interface Props {
  planId: string
  planName: string
  /** Shown to a free plan as the next step; omitted when there is none. */
  upgradePlan?: UpgradePlanHint | null
  flags: FeatureFlags
  retentionDays: number
  seatLimit: number | null
  /** seatLimit's source says null = no limit; otherwise null is unknown. */
  seatLimitKnown?: boolean
}

interface Entitlement {
  label: string
  included: boolean
  /** Optional extra detail rendered in smaller text next to the label. */
  meta?: string
}

export function PlanBenefitsList({ planId, planName, upgradePlan, flags, retentionDays, seatLimit, seatLimitKnown = false }: Props) {
  const entitlements: Entitlement[] = [
    {
      label: 'Report retention',
      included: true,
      meta: `${retentionDays} days`,
    },
    {
      label: 'Seats',
      included: true,
      // The Seats meter's own limit: the billing tier omits seat_limit, and a
      // null read as "Unlimited" next to "Seats 3 / 5" (review 2026-11-18).
      meta:
        seatEntitlementLabel({ teams: Boolean(flags.teams), seatLimit, limitKnown: seatLimitKnown }) ?? undefined,
    },
    {
      label: 'Bring your own LLM key',
      included: Boolean(flags.byok),
    },
    {
      label: 'Plugin marketplace',
      included: Boolean(flags.plugins),
    },
    {
      label: 'Audit log',
      included: Boolean(flags.audit_log),
    },
    {
      label: 'Weekly intelligence reports',
      included: Boolean(flags.intelligence_reports),
    },
    {
      label: 'SSO (SAML / OIDC)',
      included: Boolean(flags.sso),
    },
    {
      label: 'SOC 2 evidence pack',
      included: Boolean(flags.soc2),
    },
    {
      label: 'Self-hosted option',
      included: Boolean(flags.self_hosted),
    },
    {
      label: 'Support SLA',
      included: Boolean(flags.sla_hours),
      meta: flags.sla_hours ? `${flags.sla_hours}h response` : undefined,
    },
  ]

  return (
    <section
      aria-label={`Entitlements on ${planName}`}
      className="border-t border-edge-subtle pt-2"
    >
      <h4 className="mb-1.5 text-2xs font-semibold text-fg">What you get on {planName}</h4>
      <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {entitlements.map(e => (
          <li
            key={e.label}
            className="flex items-baseline gap-1.5 text-2xs"
          >
            <span
              aria-hidden="true"
              className={e.included ? 'text-ok' : 'text-fg-faint'}
            >
              {e.included ? '✓' : '—'}
            </span>
            <span className={e.included ? 'text-fg-secondary' : 'text-fg-faint line-through decoration-fg-faint/40'}>
              {e.label}
            </span>
            {e.meta && <span className="text-2xs text-fg-muted tabular-nums">· {e.meta}</span>}
          </li>
        ))}
      </ul>
      {(planId === 'hobby' || planId === 'free_cloud') && upgradePlan && (
        <InlineProof className="mt-2">
          {upgradeHintText(upgradePlan)}{' '}
          <span className="text-brand">{upgradePlan.display_name} · ${Number(upgradePlan.monthly_price_usd)}/mo</span>.
        </InlineProof>
      )}
    </section>
  )
}
