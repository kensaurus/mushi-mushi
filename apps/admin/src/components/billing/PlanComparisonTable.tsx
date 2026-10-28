/**
 * FILE: apps/admin/src/components/billing/PlanComparisonTable.tsx
 * PURPOSE: Always-visible, feature-grouped matrix of every active plan —
 *          renders Free / Builder / Studio / Enterprise side-by-side so a user
 *          can see at a glance what each tier actually unlocks. Highlights
 *          the caller's current plan with a ring + "Your plan" badge and
 *          marks Builder with a "Most popular" cue.
 *
 *          Since 2026-10-28 (docs/plan-pricing.md) a plan sells apps watched,
 *          with diagnoses as the one meter under it; reports are not billed,
 *          so the table no longer lists a report quota or a per-report price.
 *
 *          Research note: NN/g + 2026 SaaS pricing guides both flag
 *          "benefits hidden behind an upgrade button" as the #1 anti-pattern
 *          on tiered pricing pages. This table is the direct fix — the
 *          comparison lives on `/billing` by default, not behind a click.
 */

import { Badge, Btn } from '../ui'
import { ContainedBlock } from '../report-detail/ReportSurface'
import { CHIP_TONE } from '../../lib/chipTone'
import { ENTERPRISE_MAILTO, isSalesLedPlan } from '../../lib/salesContact'
import { trackAdHoc } from '../../lib/track'

interface PlanCatalogEntry {
  id: string
  display_name: string
  position: number
  monthly_price_usd: number
  /** Apps a team may watch on this plan; null = no limit. */
  max_projects?: number | null
  included_diagnoses_per_month?: number | null
  overage_unit_amount_decimal_diagnoses?: number | null
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
        key: 'apps',
        label: 'Apps',
        hint: 'Apps this team can watch. Each app gets its own widget, diagnoses and fixes.',
        render: p => (p.max_projects == null ? 'No limit' : String(p.max_projects)),
      },
      {
        key: 'diagnoses',
        label: 'Diagnoses / month',
        hint: 'Plain-English diagnoses of your bug reports. Reports are still captured past the limit.',
        render: p =>
          p.included_diagnoses_per_month == null ? 'Unlimited' : p.included_diagnoses_per_month.toLocaleString(),
      },
      {
        key: 'diagnosis_overage',
        label: 'Then, per diagnosis',
        hint: 'What each diagnosis past the monthly amount costs, up to the spend cap you set.',
        render: p =>
          p.overage_unit_amount_decimal_diagnoses != null
            ? `$${Number(p.overage_unit_amount_decimal_diagnoses).toFixed(2)} each`
            : p.included_diagnoses_per_month == null
              ? '—'
              : 'Stops at the limit',
      },
      {
        key: 'retention',
        label: 'History kept',
        hint: 'How long we keep raw report data (screenshots, console logs).',
        render: p => `${p.retention_days} days`,
      },
      {
        key: 'seats',
        label: 'Admin seats',
        hint: 'Team members that can use the console. Teams start at Studio.',
        render: p => Boolean(p.feature_flags?.teams) ? (p.seat_limit == null ? 'Unlimited' : String(p.seat_limit)) : 'Solo',
      },
    ],
  },
  {
    title: 'Platform',
    rows: [
      {
        key: 'byok',
        label: 'Use your own AI and Cursor keys',
        hint: 'Fix PRs and their reviews run on your own Anthropic / Cursor key; we bill nothing for those calls.',
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
  free_cloud: '',
  indie: 'ring-2 ring-brand/40',
  pro: 'ring-2 ring-ok/40',
  enterprise: 'ring-2 ring-warn/40',
}

/** The tier the table and the public pricing page recommend (Builder). */
const POPULAR_PLAN_ID = 'indie'

/** @internal Exported for tests only. Header price: Enterprise is sales-led but still shows where it starts. */
export function planPriceLabel(p: Pick<PlanCatalogEntry, 'id' | 'monthly_price_usd' | 'is_self_serve'>): string {
  if (isSalesLedPlan(p)) return p.monthly_price_usd > 0 ? `From $${p.monthly_price_usd}/mo` : 'Contact us'
  return p.monthly_price_usd > 0 ? `$${p.monthly_price_usd}/mo` : 'Free'
}

/**
 * Per-plan "would-it-fit" annotation rendered under each column header. Lets
 * the user gut-check downgrade / upgrade decisions against their actual
 * monthly volume without bouncing back to the project card. We deliberately
 * keep the math here (not in a parent reducer) because the whole point is
 * "compute one number relative to *this column's* limit" — extracting it
 * would just push the conditionals up a level.
 */
interface CurrentUsage {
  /** Diagnoses used this billing period by the active app. */
  diagnoses: number
  /** Apps the active app's team watches today. */
  apps: number
  /**
   * Optional human-friendly context line for the bullet under each column
   * (e.g. "this period · glot.it"). Renders verbatim under the column header
   * tally to remind the user *which* project's usage they're looking at.
   */
  contextLabel?: string
}

interface Props {
  plans: PlanCatalogEntry[]
  currentPlanId: string
  busy?: boolean
  onSelectPlan?: (planId: string) => void
  /** When provided, each plan column shows a "your usage" annotation under the
   *  price so the comparison doubles as a downgrade / upgrade fit check. */
  currentUsage?: CurrentUsage
}

interface FitVerdict {
  pct: number | null
  /** Visual tone for the annotation. `over` => danger, `near` => warn, `fits` => ok, `unbounded` => muted. */
  tone: 'over' | 'near' | 'fits' | 'unbounded'
  /** One-word verdict glyph + label, ready to drop into JSX. */
  glyph: string
  label: string
}

function evaluateFit(used: number, limit: number | null | undefined): FitVerdict {
  if (limit == null) {
    return { pct: null, tone: 'unbounded', glyph: '∞', label: 'No cap' }
  }
  const pct = Math.round((used / limit) * 100)
  if (used > limit) return { pct, tone: 'over', glyph: '●', label: 'Over' }
  if (pct >= 80) return { pct, tone: 'near', glyph: '▲', label: 'Tight' }
  return { pct, tone: 'fits', glyph: '✓', label: 'Fits' }
}

const FIT_RANK: Record<FitVerdict['tone'], number> = { over: 3, near: 2, fits: 1, unbounded: 0 }

/**
 * @internal Exported for tests only. Whether this team's apps and this
 * period's diagnoses fit a plan; the verdict is the worse of the two.
 */
export function planFit(
  usage: { diagnoses: number; apps: number },
  plan: { max_projects?: number | null; included_diagnoses_per_month?: number | null },
): { apps: FitVerdict; diagnoses: FitVerdict; verdict: FitVerdict } {
  // Apps are whole: having exactly as many as the plan allows fits; only more does not.
  const appsLimit = plan.max_projects
  const apps: FitVerdict =
    appsLimit == null
      ? evaluateFit(usage.apps, null)
      : usage.apps > appsLimit
        ? { pct: Math.round((usage.apps / appsLimit) * 100), tone: 'over', glyph: '●', label: 'Over' }
        : { pct: Math.round((usage.apps / appsLimit) * 100), tone: 'fits', glyph: '✓', label: 'Fits' }
  const diagnoses = evaluateFit(usage.diagnoses, plan.included_diagnoses_per_month)
  const verdict = FIT_RANK[apps.tone] >= FIT_RANK[diagnoses.tone] ? apps : diagnoses
  return { apps, diagnoses, verdict }
}

const FIT_TONE: Record<FitVerdict['tone'], string> = {
  over: 'text-danger',
  near: 'text-warn',
  fits: 'text-ok',
  unbounded: 'text-fg-muted',
}

export function PlanComparisonTable({
  plans,
  currentPlanId,
  busy = false,
  onSelectPlan,
  currentUsage,
}: Props) {
  const sorted = [...plans]
    .filter(p => p.active)
    .sort((a, b) => a.position - b.position)
  if (sorted.length === 0) return null

  return (
    <section
      aria-labelledby="plans-heading"
      className="border border-edge-subtle rounded-md p-3 bg-surface-raised/30"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <h3 id="plans-heading" className="text-sm font-semibold text-fg">
            Plans at a glance
          </h3>
          <ContainedBlock tone="muted" className="mt-1">
            <p className="text-2xs text-fg-muted">
              Billed monthly or yearly (2 months free) · cancel any time · prices in USD
              {currentUsage && (
                <>
                  {' · '}
                  <span className="text-fg-secondary">
                    Each column shows whether your{' '}
                    <span className="font-mono text-fg">{currentUsage.apps.toLocaleString()}</span>{' '}
                    app{currentUsage.apps === 1 ? '' : 's'} and{' '}
                    <span className="font-mono text-fg">{currentUsage.diagnoses.toLocaleString()}</span>{' '}
                    diagnos{currentUsage.diagnoses === 1 ? 'is' : 'es'} this period would fit
                  </span>
                </>
              )}
            </p>
          </ContainedBlock>
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
          const isPopular = p.id === POPULAR_PLAN_ID
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
                  <Badge className={`${CHIP_TONE.okSubtle} text-3xs`}>
                    Your plan
                  </Badge>
                )}
              </div>
              <div className="text-sm font-mono text-fg-secondary mt-1">
                {planPriceLabel(p)}
              </div>
              {currentUsage && (() => {
                const fit = planFit(currentUsage, p)
                const appsLimit = p.max_projects == null ? '∞' : p.max_projects.toLocaleString()
                const diagLimit = p.included_diagnoses_per_month == null ? '∞' : p.included_diagnoses_per_month.toLocaleString()
                const summary = `${currentUsage.apps.toLocaleString()} of ${appsLimit} apps, ${currentUsage.diagnoses.toLocaleString()} of ${diagLimit} diagnoses`
                return (
                  <div
                    className={`mt-1.5 flex flex-col items-center gap-0.5 ${FIT_TONE[fit.verdict.tone]}`}
                    aria-label={`Your usage on ${p.display_name}: ${summary}. ${fit.verdict.label}.`}
                    title={`On ${p.display_name}: ${summary}.`}
                  >
                    <span className="text-2xs font-mono tabular-nums">
                      {currentUsage.apps.toLocaleString()} / {appsLimit} apps
                    </span>
                    <span className="text-2xs font-mono tabular-nums">
                      {currentUsage.diagnoses.toLocaleString()} / {diagLimit}
                    </span>
                    <span className="text-3xs uppercase tracking-wider font-medium">
                      <span aria-hidden="true" className="mr-0.5">{fit.verdict.glyph}</span>
                      {fit.verdict.label}
                    </span>
                  </div>
                )
              })()}
              {onSelectPlan && !isCurrent && !isSalesLedPlan(p) && (
                <Btn
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => {
                    trackAdHoc('plan_selected', { plan_id: p.id, interval: 'monthly', surface: 'console_plans' })
                    onSelectPlan(p.id)
                  }}
                  disabled={busy}
                  loading={busy}
                >
                  {currentPlanId === 'hobby' || currentPlanId === 'free_cloud' ? `Start ${p.display_name}` : `Switch to ${p.display_name}`}
                </Btn>
              )}
              {isSalesLedPlan(p) && !isCurrent && (
                <a
                  href={ENTERPRISE_MAILTO}
                  className="mt-2 block text-2xs text-accent-foreground hover:text-accent"
                >
                  Contact us →
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
