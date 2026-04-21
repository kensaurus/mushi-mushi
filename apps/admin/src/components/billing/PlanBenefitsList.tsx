/**
 * FILE: apps/admin/src/components/billing/PlanBenefitsList.tsx
 * PURPOSE: Per-project "what you get on <plan>" checklist shown under the
 *          usage bar on each ProjectBillingCard. Turns opaque feature flags
 *          (`sso: true`, `byok: true`) into plain-language, scannable rows so
 *          a paid customer can answer "am I actually getting what I paid for?"
 *          without opening the plan comparison.
 */

interface FeatureFlags {
  sso?: boolean
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
  flags: FeatureFlags
  retentionDays: number
  seatLimit: number | null
}

interface Entitlement {
  label: string
  included: boolean
  /** Optional extra detail rendered in smaller text next to the label. */
  meta?: string
}

export function PlanBenefitsList({ planId, planName, flags, retentionDays, seatLimit }: Props) {
  const entitlements: Entitlement[] = [
    {
      label: 'Report retention',
      included: true,
      meta: `${retentionDays} days`,
    },
    {
      label: 'Admin seats',
      included: true,
      meta: seatLimit == null ? 'Unlimited' : `${seatLimit}`,
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
      <h4 className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">
        What you get on {planName}
      </h4>
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
            {e.meta && (
              <span className="text-fg-faint font-mono">· {e.meta}</span>
            )}
          </li>
        ))}
      </ul>
      {planId === 'hobby' && (
        <p className="text-2xs text-fg-faint mt-2">
          Unlock BYOK, plugins, and an audit log by upgrading to{' '}
          <span className="text-brand">Starter · $19/mo</span>.
        </p>
      )}
    </section>
  )
}
