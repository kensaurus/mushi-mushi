/**
 * FILE: apps/admin/src/components/billing/PlanComparisonTable.tsx
 * PURPOSE: Always-visible, feature-grouped matrix of every active plan —
 *          renders Hobby / Starter / Pro / Enterprise side-by-side so a user
 *          can see at a glance what each tier actually unlocks. Highlights
 *          the caller's current plan with a ring + "Your plan" badge and
 *          marks Starter with a "Most Popular" cue.
 *
 *          Research note: NN/g + 2026 SaaS pricing guides both flag
 *          "benefits hidden behind an upgrade button" as the #1 anti-pattern
 *          on tiered pricing pages. This table is the direct fix — the
 *          comparison lives on `/billing` by default, not behind a click.
 */

import { Badge, Btn } from '../ui'

interface PlanCatalogEntry {
  id: string
  display_name: string
  position: number
  monthly_price_usd: number
  included_reports_per_month: number | null
  overage_unit_amount_decimal: number | null
  retention_days: number
  seat_limit: number | null
  is_self_serve: boolean
  active: boolean
  feature_flags: Record<string, unknown>
}

interface FeatureRow {
  key: string
  label: string
  hint?: string
  /** Render the value for a given plan. `true/false` → ✓/—, anything else rendered as-is. */
  render: (plan: PlanCatalogEntry) => string | boolean
}

interface FeatureGroup {
  title: string
  rows: FeatureRow[]
}

const GROUPS: FeatureGroup[] = [
  {
    title: 'Usage',
    rows: [
      {
        key: 'reports',
        label: 'Reports / month',
        hint: 'Classified user-felt bug reports included in the base price.',
        render: p =>
          p.included_reports_per_month == null
            ? 'Unlimited'
            : p.included_reports_per_month.toLocaleString(),
      },
      {
        key: 'overage',
        label: 'Overage',
        hint: 'What each extra report costs once you pass the quota.',
        render: p =>
          p.overage_unit_amount_decimal == null
            ? '—'
            : `$${Number(p.overage_unit_amount_decimal).toFixed(4)} / report`,
      },
      {
        key: 'retention',
        label: 'Report retention',
        hint: 'How long we keep raw report data (screenshots, console logs).',
        render: p => `${p.retention_days} days`,
      },
      {
        key: 'seats',
        label: 'Admin seats',
        hint: 'Team members that can access the admin console.',
        render: p => (p.seat_limit == null ? 'Unlimited' : String(p.seat_limit)),
      },
    ],
  },
  {
    title: 'Platform',
    rows: [
      {
        key: 'byok',
        label: 'Bring your own LLM key',
        hint: 'Plug in your own Anthropic / OpenAI key — we bill nothing for LLM calls.',
        render: p => Boolean(p.feature_flags?.byok),
      },
      {
        key: 'plugins',
        label: 'Plugin marketplace',
        hint: 'Linear / PagerDuty / Zapier bridges with HMAC-signed webhooks.',
        render: p => Boolean(p.feature_flags?.plugins),
      },
      {
        key: 'intelligence',
        label: 'Weekly intelligence reports',
        hint: 'Auto-generated themes, regressions, and fragile areas — in your inbox.',
        render: p => Boolean(p.feature_flags?.intelligence_reports),
      },
      {
        key: 'self_hosted',
        label: 'Self-hosted option',
        hint: 'Run Mushi in your own Supabase + AWS account.',
        render: p => Boolean(p.feature_flags?.self_hosted),
      },
    ],
  },
  {
    title: 'Security & support',
    rows: [
      {
        key: 'sso',
        label: 'SSO (SAML / OIDC)',
        hint: 'Enterprise identity provider integration via Supabase Auth.',
        render: p => Boolean(p.feature_flags?.sso),
      },
      {
        key: 'audit_log',
        label: 'Audit log',
        hint: 'Every admin action logged and exportable as CSV.',
        render: p => Boolean(p.feature_flags?.audit_log),
      },
      {
        key: 'soc2',
        label: 'SOC 2 evidence pack',
        hint: 'Printable control evidence for auditors.',
        render: p => Boolean(p.feature_flags?.soc2),
      },
      {
        key: 'sla',
        label: 'Support SLA',
        hint: 'Response time target for paid support tickets.',
        render: p => {
          const hours = p.feature_flags?.sla_hours as number | null | undefined
          return hours ? `${hours}h response` : '—'
        },
      },
    ],
  },
]

const HIGHLIGHT: Record<string, string> = {
  hobby: '',
  starter: 'ring-2 ring-brand/40',
  pro: 'ring-2 ring-ok/40',
  enterprise: 'ring-2 ring-warn/40',
}

interface Props {
  plans: PlanCatalogEntry[]
  currentPlanId: string
  busy?: boolean
  onSelectPlan?: (planId: string) => void
}

export function PlanComparisonTable({ plans, currentPlanId, busy = false, onSelectPlan }: Props) {
  const sorted = [...plans]
    .filter(p => p.active)
    .sort((a, b) => a.position - b.position)
  if (sorted.length === 0) return null

  return (
    <section
      aria-labelledby="plans-heading"
      className="border border-edge-subtle rounded-md p-3 bg-surface-subtle"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <h3 id="plans-heading" className="text-sm font-semibold text-fg">
            Plans at a glance
          </h3>
          <p className="text-2xs text-fg-faint mt-0.5">
            Billed monthly · cancel any time · prices in USD
          </p>
        </div>
        <span className="text-3xs text-fg-faint font-mono uppercase tracking-wider">
          Your plan is highlighted
        </span>
      </header>

      <div
        role="table"
        aria-label="Plan comparison"
        className="grid gap-2"
        style={{ gridTemplateColumns: `minmax(10rem, 1.4fr) repeat(${sorted.length}, minmax(8rem, 1fr))` }}
      >
        {/* Header row */}
        <div role="rowheader" className="text-2xs text-fg-faint uppercase tracking-wider self-end pb-1">
          Feature
        </div>
        {sorted.map(p => {
          const isCurrent = p.id === currentPlanId
          const isPopular = p.id === 'starter'
          return (
            <div
              key={`hdr-${p.id}`}
              role="columnheader"
              className={`rounded-md bg-surface p-2 text-center ${HIGHLIGHT[p.id] ?? ''} ${isCurrent ? 'shadow-sm' : ''}`}
            >
              <div className="flex flex-wrap items-center justify-center gap-1">
                <span className="text-sm font-semibold text-fg">{p.display_name}</span>
                {isPopular && (
                  <Badge className="bg-brand-subtle text-brand text-3xs">
                    Most popular
                  </Badge>
                )}
                {isCurrent && (
                  <Badge className="bg-ok-muted text-ok text-3xs">
                    Your plan
                  </Badge>
                )}
              </div>
              <div className="text-sm font-mono text-fg-secondary mt-1">
                {p.monthly_price_usd > 0
                  ? `$${p.monthly_price_usd}/mo`
                  : p.id === 'enterprise'
                    ? 'Talk to us'
                    : 'Free'}
              </div>
              {onSelectPlan && !isCurrent && p.is_self_serve && (
                <Btn
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => onSelectPlan(p.id)}
                  disabled={busy}
                  loading={busy}
                >
                  {currentPlanId === 'hobby' ? `Start ${p.display_name}` : `Switch to ${p.display_name}`}
                </Btn>
              )}
              {p.id === 'enterprise' && !isCurrent && (
                <a
                  href="mailto:hello@mushimushi.dev?subject=Enterprise%20inquiry"
                  className="mt-2 block text-2xs text-brand hover:text-brand-hover"
                >
                  Email sales →
                </a>
              )}
            </div>
          )
        })}

        {/* Feature rows, grouped */}
        {GROUPS.map((group, gi) => (
          <FeatureGroupRows key={group.title} group={group} plans={sorted} currentPlanId={currentPlanId} isLast={gi === GROUPS.length - 1} />
        ))}
      </div>
    </section>
  )
}

function FeatureGroupRows({
  group,
  plans,
  currentPlanId,
  isLast,
}: {
  group: FeatureGroup
  plans: PlanCatalogEntry[]
  currentPlanId: string
  isLast: boolean
}) {
  return (
    <>
      <div
        role="rowheader"
        className="col-span-full mt-3 text-3xs text-fg-faint font-mono uppercase tracking-wider border-b border-edge-subtle pb-1"
      >
        {group.title}
      </div>
      {group.rows.map((row, ri) => (
        <RowCells key={row.key} row={row} plans={plans} currentPlanId={currentPlanId} isLastRow={isLast && ri === group.rows.length - 1} />
      ))}
    </>
  )
}

function RowCells({
  row,
  plans,
  currentPlanId,
  isLastRow,
}: {
  row: FeatureRow
  plans: PlanCatalogEntry[]
  currentPlanId: string
  isLastRow: boolean
}) {
  return (
    <>
      <div
        role="rowheader"
        className={`py-1.5 text-2xs text-fg-muted ${isLastRow ? '' : 'border-b border-edge-subtle/60'}`}
      >
        <span className="font-medium text-fg-secondary">{row.label}</span>
        {row.hint && (
          <span className="block text-3xs text-fg-faint mt-0.5">{row.hint}</span>
        )}
      </div>
      {plans.map(p => {
        const value = row.render(p)
        const isCurrent = p.id === currentPlanId
        return (
          <div
            key={`${row.key}-${p.id}`}
            role="cell"
            className={`py-1.5 text-center text-2xs font-mono ${isLastRow ? '' : 'border-b border-edge-subtle/60'} ${isCurrent ? 'bg-surface/50' : ''}`}
            aria-label={`${p.display_name} ${row.label}: ${typeof value === 'boolean' ? (value ? 'included' : 'not included') : value}`}
          >
            {typeof value === 'boolean'
              ? value
                ? <span className="text-ok" aria-hidden="true">✓</span>
                : <span className="text-fg-faint" aria-hidden="true">—</span>
              : <span className="text-fg">{value}</span>}
          </div>
        )
      })}
    </>
  )
}
