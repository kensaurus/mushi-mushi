/**
 * Quota usage bar with sparkline for a billing project card.
 */

import { Link } from 'react-router-dom'
import { Badge, Sparkline } from '../ui'
import { SignalChip } from '../report-detail/ReportSurface'
import { formatLlmCost } from '../../lib/format'
import { CHIP_TONE } from '../../lib/chipTone'
import { appUsageFacts } from '../../lib/billingView'
import { formatSpendUsd } from '../../lib/costView'
import { sdkHealthHref } from '../../lib/sdkHealth'
import {
  buildUsageForecast,
  daysUntilPeriodReset,
  formatPeriodResetLabel,
  type PeriodCostInputs,
} from '../../lib/billingUsageForecast'
import type { BillingProject } from './types'

export interface BillingUsageBarProps {
  usage: BillingProject['usage']
  limitReports: number | null
  pct: number | null
  periodStart: string | null
  periodEnd: string | null
  /** §3: real $ spent on LLM calls this billing month. */
  llmCostUsd?: number
  /** API-flagged: ingest is currently being rejected (Free) or overage-billed (paid). */
  overQuota: boolean
  /** ADR 0063: a free project on its own AI key: the diagnosis cap does not stop it. */
  byokUncapped?: boolean
  /** USD per report once over included quota. `null` for plans without metered overage. */
  overageRate: number | null
  overageRateDiagnoses?: number | null
  basePriceUsd?: number
  spendCapUsd?: number | null
  /** `'hobby' | 'starter' | 'pro' | 'enterprise'` — drives whether overage is billed or rejected. */
  tierId: string
  /**
   * 30-day daily reports series (oldest → newest, always 30 entries). When
   * present, renders a sparkline + summary caption beneath the progress bar
   * so the user can verify the headline count against the actual temporal
   * shape of their ingest. Omit on legacy API responses → section hides.
   */
  usageSeries?: BillingProject['usage_series']
  /** Phase 2: diagnoses-metered plans — when non-null, show diagnoses count/limit instead of reports. */
  diagnosesUsed?: number | null
  diagnosesLimit?: number | null
  /**
   * Complimentary org (no Stripe charges): the quota forecast still shows,
   * but never a projected dollar bill.
   */
  complimentary?: boolean
  /**
   * The team meters at the top of Billing already draw the quota count, its
   * bar, "% used" and the reset: skip them here, keep the forecast and any
   * warning (review 2026-11-18: 24 / 3,000 and "1% used" each shown twice).
   */
  quotaInStrip?: boolean
  /** The app this card is for: its own counts say so. */
  appName?: string
  /** For the "check SDK health" link when the app sent nothing. */
  projectId?: string
}

// Severity tone the whole UsageBar takes on — matches across chip, progress
// bar, and headline number so the user gets one consistent visual signal.
type UsageTone = 'ok' | 'warn' | 'danger' | 'muted'

interface UsageHeadline {
  tone: UsageTone
  /** Short label for the right-aligned chip ("Healthy" / "Approaching quota" / "Over quota"). */
  chipLabel: string
  /** Long-form sentence under the bar. Plan-aware. `null` => suppress (no signal yet). */
  narrative: string | null
}

const USAGE_CHIP_TONE: Record<UsageTone, string> = {
  ok: CHIP_TONE.ok,
  warn: CHIP_TONE.warn,
  danger: CHIP_TONE.danger,
  muted: 'bg-surface-overlay text-fg-muted',
}

const USAGE_BAR_TONE: Record<UsageTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  muted: 'bg-fg-faint/40',
}

const USAGE_NUMBER_TONE: Record<UsageTone, string> = {
  ok: 'text-fg',
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-fg',
}

/** ADR 0063: the project's own AI key runs its diagnoses, so the free cap never pauses them. */
const BYOK_UNCAPPED_HEADLINE: UsageHeadline = {
  tone: 'muted',
  chipLabel: 'Own AI key',
  narrative: 'Your own AI key runs these diagnoses, so the free cap does not stop them.',
}

/**
 * Build the severity tone + plan-aware narrative for a single project's quota.
 * Free (and the retired Hobby) gets "rejected" copy because the gateway HTTP-402s past the limit;
 * paid plans get "billed" copy because the meter just keeps going.
 */
function buildUsageHeadline(
  used: number,
  limit: number | null,
  pct: number | null,
  overQuota: boolean,
  overageRate: number | null,
  tierId: string,
  diagnoses = false,
): UsageHeadline {
  if (limit == null) {
    return { tone: 'muted', chipLabel: 'Unlimited', narrative: 'No monthly cap on this plan.' }
  }
  const isHobby = tierId === 'hobby' || tierId === 'free_cloud'
  const unit = (n: number) => (diagnoses ? (n === 1 ? 'diagnosis' : 'diagnoses') : n === 1 ? 'report' : 'reports')
  if (overQuota || (pct != null && pct >= 100)) {
    const overageReports = Math.max(0, used - limit)
    if (diagnoses && (overageRate == null || overageRate <= 0)) {
      // Plans without diagnosis overage (free, annual) pause new diagnoses at
      // the limit; reports keep arriving.
      return {
        tone: 'danger',
        chipLabel: 'Limit reached',
        narrative:
          'New diagnoses are paused until the quota resets. Reports are still captured. Use Change plan or Upgrade for more.',
      }
    }
    if (isHobby || overageRate == null || overageRate <= 0) {
      return {
        tone: 'danger',
        chipLabel: 'Over quota',
        narrative:
          overageReports > 0
            ? `${overageReports.toLocaleString()} report${overageReports === 1 ? '' : 's'} rejected this period — upgrade to keep ingesting.`
            : 'New reports are being rejected — upgrade to keep ingesting.',
      }
    }
    const overageUsd = overageReports * overageRate
    return {
      tone: 'danger',
      chipLabel: 'Over quota',
      narrative: `${overageReports.toLocaleString()} overage report${overageReports === 1 ? '' : 's'} — billed at $${overageRate.toFixed(4)}/each = ${formatLlmCost(overageUsd)} this cycle.`,
    }
  }
  if (pct != null && pct >= 80) {
    const remaining = Math.max(0, limit - used)
    return {
      tone: 'warn',
      chipLabel: `Approaching quota`,
      narrative: `${remaining.toLocaleString()} ${unit(remaining)} of headroom left this period.`,
    }
  }
  if (pct != null && pct >= 50) {
    const remaining = Math.max(0, limit - used)
    return {
      tone: 'ok',
      chipLabel: `${pct}% used`,
      narrative: `${remaining.toLocaleString()} ${unit(remaining)} of headroom left.`,
    }
  }
  return {
    tone: 'ok',
    chipLabel: pct != null ? `${pct}% used` : 'Healthy',
    narrative: pct === 0 || pct == null ? 'Plenty of headroom this period.' : null,
  }
}

interface UsageSeriesSummary {
  values: number[]
  total: number
  activeDays: number
  peakReports: number
  peakDayLabel: string | null
  /** Most recent day with any reports, formatted as "Apr 23" — null when fully idle. */
  lastActiveDayLabel: string | null
  lastActiveDaysAgo: number | null
  /** Average reports / active day, rounded to 1dp. 0 when no active days. */
  avgPerActiveDay: number
}

/**
 * Derive everything the sparkline section needs from a 30-day daily reports
 * series. Built once per render rather than splattered across JSX so the
 * component stays scannable and the math is easy to test.
 */
function summariseUsageSeries(
  series: BillingProject['usage_series'],
): UsageSeriesSummary | null {
  if (!series || !Array.isArray(series.days) || series.days.length === 0) return null
  const values = series.days.map((d) => Math.max(0, Number(d.reports) || 0))
  const total = values.reduce((a, b) => a + b, 0)
  const activeBuckets = series.days.filter((d) => (Number(d.reports) || 0) > 0)
  const activeDays = activeBuckets.length
  const avgPerActiveDay = activeDays > 0 ? Math.round((total / activeDays) * 10) / 10 : 0

  let peakReports = 0
  let peakDayLabel: string | null = null
  for (const d of series.days) {
    const v = Number(d.reports) || 0
    if (v > peakReports) {
      peakReports = v
      peakDayLabel = formatShortDay(d.day)
    }
  }

  let lastActiveDayLabel: string | null = null
  let lastActiveDaysAgo: number | null = null
  for (let i = series.days.length - 1; i >= 0; i--) {
    if ((Number(series.days[i].reports) || 0) > 0) {
      lastActiveDayLabel = formatShortDay(series.days[i].day)
      lastActiveDaysAgo = series.days.length - 1 - i
      break
    }
  }

  return {
    values,
    total,
    activeDays,
    peakReports,
    peakDayLabel,
    lastActiveDayLabel,
    lastActiveDaysAgo,
    avgPerActiveDay,
  }
}

function formatShortDay(yyyyMmDd: string): string | null {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  if (!y || !m || !d) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const SPARK_TONE: Record<UsageTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-fg-muted',
}

export function BillingUsageBar({
  usage,
  limitReports,
  pct,
  periodStart,
  periodEnd,
  llmCostUsd,
  overQuota,
  byokUncapped = false,
  overageRate,
  overageRateDiagnoses,
  basePriceUsd = 0,
  spendCapUsd,
  tierId,
  usageSeries,
  diagnosesUsed,
  diagnosesLimit,
  complimentary = false,
  quotaInStrip = false,
  appName = 'This app',
  projectId,
}: BillingUsageBarProps) {
  // Phase 2: prefer diagnoses metering when the plan has a diagnoses limit.
  const usingDiagnoses = diagnosesLimit != null
  const displayCount = usingDiagnoses ? (diagnosesUsed ?? 0) : usage.reports
  const displayLimit = usingDiagnoses ? diagnosesLimit : limitReports
  const displayLabel = usingDiagnoses ? 'diagnoses this period' : 'reports this period'

  const headline = byokUncapped && usingDiagnoses
    ? BYOK_UNCAPPED_HEADLINE
    : buildUsageHeadline(displayCount, displayLimit, pct, overQuota, overageRate, tierId, usingDiagnoses)
  const barTone = USAGE_BAR_TONE[headline.tone]
  // Bar fill: clamp at 100% so the visual length stays sane, but the chip +
  // narrative still report the *real* overage above the bar.
  const barWidthPct = pct == null ? 0 : Math.min(100, Math.max(2, pct))

  const costInputs: PeriodCostInputs | null =
    !complimentary && usingDiagnoses && overageRateDiagnoses != null && overageRateDiagnoses > 0
      ? {
          baseUsd: basePriceUsd,
          included: diagnosesLimit ?? 0,
          overageRate: overageRateDiagnoses,
          spendCapUsd: spendCapUsd ?? null,
        }
      : null

  const forecast = buildUsageForecast(
    displayCount,
    displayLimit,
    periodStart,
    periodEnd,
    costInputs,
  )
  const resetLabel = formatPeriodResetLabel(daysUntilPeriodReset(periodEnd))
  const seriesSummary = summariseUsageSeries(usageSeries)
  const showQuota = !quotaInStrip
  // With the meter above, a calm narrative ("Plenty of headroom") restates
  // the 1% bar; only a warning stays.
  const narrative =
    showQuota || headline.tone === 'warn' || headline.tone === 'danger' ? headline.narrative : null
  const worstTone =
    headline.tone === 'danger' || forecast?.tone === 'danger'
      ? 'danger'
      : headline.tone === 'warn' || forecast?.tone === 'warn'
        ? 'warn'
        : 'muted'
  const forecastLine = [narrative, forecast?.label, forecast?.projectedCostLabel].filter(Boolean).join(' · ')
  const appFacts = appUsageFacts(usage, llmCostUsd, formatSpendUsd, { includeFixes: !quotaInStrip })

  return (
    <section
      className="space-y-2"
      aria-label={`Quota usage: ${headline.chipLabel}${pct != null ? ` (${pct}%)` : ''}`}
      data-quota-tone={headline.tone}
    >
      {/* Headline row — the count + severity chip are now the focal point of
          the card. Tabular-nums keeps the digits aligned across re-renders.
          Skipped when the team meters above already draw it. */}
      {showQuota && (
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className={`text-base font-semibold tabular-nums ${USAGE_NUMBER_TONE[headline.tone]}`}>
              {displayCount.toLocaleString()}
            </span>
            {displayLimit != null ? (
              <span className="text-xs text-fg-muted tabular-nums">
                / {displayLimit.toLocaleString()}
              </span>
            ) : (
              <span className="text-xs text-fg-faint">unlimited</span>
            )}
            <SignalChip tone="neutral" className="tabular-nums">
              {displayLabel}
            </SignalChip>
          </div>
        </div>
        <Badge className={USAGE_CHIP_TONE[headline.tone]} title={headline.narrative ?? undefined}>
          {/* Tone glyph — small visual anchor so the chip reads at a squint
              even when colour is missing (high-contrast mode, colour-blind). */}
          <span aria-hidden="true" className="mr-1 leading-none">
            {headline.tone === 'danger' ? '●' : headline.tone === 'warn' ? '▲' : headline.tone === 'muted' ? '∞' : '○'}
          </span>
          {headline.chipLabel}
          {pct != null && headline.chipLabel !== `${pct}% used` && (
            <span className="ml-1 opacity-80 tabular-nums">{pct}%</span>
          )}
        </Badge>
      </div>
      )}

      {showQuota && displayLimit != null && (
        <div
          className="relative h-2.5 bg-surface-overlay rounded-sm overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, pct ?? 0)}
          aria-valuetext={`${pct ?? 0}% of monthly quota used`}
        >
          <div
            className={`h-full ${barTone} motion-safe:transition-[width] duration-500`}
            style={{ width: `${barWidthPct}%` }}
          />
          {/* 80% milestone tick — gives the eye something to land on between
              "comfortable" and "you should look at this". Hidden when over quota
              so the danger bar reads as a single saturated block. */}
          {headline.tone !== 'danger' && (
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-px bg-edge-subtle/80"
              style={{ left: '80%' }}
            />
          )}
        </div>
      )}

      {/* One sans line that wraps: the forecast used to be a monospace chip
          in a grey box, cut to "at th…" at 390 (review 2026-11-18). */}
      {forecastLine && (
        <p
          className={`text-2xs leading-snug text-pretty ${
            worstTone === 'danger' ? 'text-danger' : worstTone === 'warn' ? 'text-warn' : 'text-fg-muted'
          }`}
          data-testid="billing-usage-forecast"
        >
          {forecastLine}
        </p>
      )}

      {showQuota && resetLabel && (
        <p className="text-2xs text-fg-muted tabular-nums">{resetLabel}</p>
      )}

      {/* 30-day reports trend — sits between the period headline and the
          secondary metrics so the user can sanity-check the big number ("am I
          really at 60k?") against the actual time distribution. The
          sparkline inherits the headline tone so the chart, chip, and bar all
          read as one coherent severity signal. When the project has been
          fully idle for 30 days we suppress the chart and show a one-line
          empty state instead — a flat zero line is visual noise, not signal. */}
      {seriesSummary && (
        <section
          className="border-t border-edge-subtle/60 pt-2 space-y-1"
          aria-label="Last 30 days of reports ingested"
        >
          {/* This app's own reports, not the team's: "0 reports" sat under
              the team's "24 / 3,000 diagnoses" with no scope (review 2026-11-18). */}
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h4 className="text-2xs font-semibold text-fg">Reports from {appName} · last 30 days</h4>
            {seriesSummary.total > 0 && (
              <p className="text-2xs text-fg-muted tabular-nums">
                {seriesSummary.total.toLocaleString()} report{seriesSummary.total === 1 ? '' : 's'}
                <span aria-hidden="true" className="mx-1">·</span>
                {seriesSummary.activeDays} active day{seriesSummary.activeDays === 1 ? '' : 's'}
              </p>
            )}
          </div>
          {seriesSummary.total > 0 ? (
            <div className="flex items-center gap-3 flex-wrap">
              <div className={SPARK_TONE[headline.tone]}>
                <Sparkline
                  values={seriesSummary.values}
                  width={180}
                  height={28}
                  ariaLabel={`Daily reports trend over the last 30 days. Total ${seriesSummary.total}, ${seriesSummary.activeDays} active days, peak ${seriesSummary.peakReports}${seriesSummary.peakDayLabel ? ` on ${seriesSummary.peakDayLabel}` : ''}.`}
                />
              </div>
              <p className="text-2xs text-fg-muted tabular-nums">
                {[
                  seriesSummary.avgPerActiveDay > 0 ? `${seriesSummary.avgPerActiveDay} / active day` : null,
                  seriesSummary.peakDayLabel && seriesSummary.peakReports > 0
                    ? `peak ${seriesSummary.peakReports.toLocaleString()} on ${seriesSummary.peakDayLabel}`
                    : null,
                  seriesSummary.lastActiveDayLabel && seriesSummary.lastActiveDaysAgo != null
                    ? `last activity ${
                        seriesSummary.lastActiveDaysAgo === 0
                          ? 'today'
                          : seriesSummary.lastActiveDaysAgo === 1
                            ? 'yesterday'
                            : `${seriesSummary.lastActiveDaysAgo}d ago`
                      }`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          ) : (
            // One plain line, not a dashed box; whether the app is checking in
            // is SDK health's job (Connect), not Billing's (review 2026-11-18).
            <p className="text-2xs text-fg-muted text-pretty" data-testid="billing-app-no-reports">
              None.{' '}
              {projectId ? (
                <Link to={sdkHealthHref(projectId)} className="text-fg underline underline-offset-2 hover:text-accent">
                  Check SDK health
                </Link>
              ) : null}
            </p>
          )}
        </section>
      )}

      {/* This app's own counts, flat. With the team meters shown, Fixes
          merged is theirs only: "Fixes merged 191" beside "Fixes merged 0"
          was two scopes with one label (review 2026-11-18). Zeros are grey. */}
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-edge-subtle/60 pt-2 text-2xs text-fg-muted">
        <span>{appName} this period</span>
        {appFacts.map((f) => (
          <span key={f.label} title={f.label === 'AI cost' ? 'Spent on AI calls this billing month, from llm_invocations.cost_usd' : undefined}>
            <span aria-hidden="true" className="mr-2">·</span>
            {f.label}{' '}
            <span className={`tabular-nums font-medium ${f.zero ? 'text-fg-faint' : 'text-fg'}`}>{f.value}</span>
          </span>
        ))}
      </p>
    </section>
  )
}
