/**
 * Quota usage bar with sparkline for a billing project card.
 */

import { Badge, Sparkline } from '../ui'
import { ContainedBlock, InlineProof, SignalChip } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import { formatLlmCost } from '../../lib/format'
import { CHIP_TONE } from '../../lib/chipTone'
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
  /** API-flagged: ingest is currently being rejected (Hobby) or overage-billed (paid). */
  overQuota: boolean
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
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
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

/**
 * Build the severity tone + plan-aware narrative for a single project's quota.
 * Hobby gets "rejected" copy because the gateway HTTP-402s past the limit;
 * paid plans get "billed" copy because the meter just keeps going.
 */
function buildUsageHeadline(
  used: number,
  limit: number | null,
  pct: number | null,
  overQuota: boolean,
  overageRate: number | null,
  tierId: string,
): UsageHeadline {
  if (limit == null) {
    return { tone: 'muted', chipLabel: 'Unlimited', narrative: 'No monthly cap on this plan.' }
  }
  const isHobby = tierId === 'hobby'
  if (overQuota || (pct != null && pct >= 100)) {
    const overageReports = Math.max(0, used - limit)
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
      narrative: `${remaining.toLocaleString()} report${remaining === 1 ? '' : 's'} of headroom left this period.`,
    }
  }
  if (pct != null && pct >= 50) {
    const remaining = Math.max(0, limit - used)
    return {
      tone: 'ok',
      chipLabel: `${pct}% used`,
      narrative: `${remaining.toLocaleString()} reports of headroom left.`,
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
  overageRate,
  overageRateDiagnoses,
  basePriceUsd = 0,
  spendCapUsd,
  tierId,
  usageSeries,
  diagnosesUsed,
  diagnosesLimit,
}: BillingUsageBarProps) {
  // Phase 2: prefer diagnoses metering when the plan has a diagnoses limit.
  const usingDiagnoses = diagnosesLimit != null
  const displayCount = usingDiagnoses ? (diagnosesUsed ?? 0) : usage.reports
  const displayLimit = usingDiagnoses ? diagnosesLimit : limitReports
  const displayLabel = usingDiagnoses ? 'diagnoses this period' : 'reports this period'

  const headline = buildUsageHeadline(displayCount, displayLimit, pct, overQuota, overageRate, tierId)
  const barTone = USAGE_BAR_TONE[headline.tone]
  // Bar fill: clamp at 100% so the visual length stays sane, but the chip +
  // narrative still report the *real* overage above the bar.
  const barWidthPct = pct == null ? 0 : Math.min(100, Math.max(2, pct))

  const costInputs: PeriodCostInputs | null =
    usingDiagnoses && overageRateDiagnoses != null && overageRateDiagnoses > 0
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

  return (
    <section
      className="space-y-2"
      aria-label={`Quota usage: ${headline.chipLabel}${pct != null ? ` (${pct}%)` : ''}`}
      data-quota-tone={headline.tone}
    >
      {/* Headline row — the count + severity chip are now the focal point of
          the card. Tabular-nums keeps the digits aligned across re-renders. */}
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
            <span className="ml-1 font-mono opacity-80 tabular-nums">{pct}%</span>
          )}
        </Badge>
      </div>

      {displayLimit != null && (
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

      {(headline.narrative || forecast) && (
        <ContainedBlock tone={headline.tone === 'danger' ? 'warn' : headline.tone === 'warn' ? 'warn' : 'muted'} className="flex flex-wrap items-center gap-2">
          {headline.narrative && (
            <InlineProof className={`border-0 bg-transparent px-0 py-0 ${headline.tone === 'danger' ? 'text-danger' : headline.tone === 'warn' ? 'text-warn' : ''}`}>
              {headline.narrative}
            </InlineProof>
          )}
          {forecast && (
            <SignalChip tone={forecast.tone === 'danger' ? 'danger' : forecast.tone === 'warn' ? 'warn' : 'neutral'} className="font-mono">
              {forecast.label}
            </SignalChip>
          )}
          {forecast?.projectedCostLabel && (
            <SignalChip tone="neutral" className="font-mono">
              {forecast.projectedCostLabel}
            </SignalChip>
          )}
        </ContainedBlock>
      )}

      {resetLabel && (
        <InlineProof className="border-0 bg-transparent px-0 py-0 text-fg-muted tabular-nums">
          {resetLabel}
        </InlineProof>
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <SignalChip tone="neutral" className="uppercase tracking-wider">
              Last 30 days
            </SignalChip>
            <InlineProof className="border-0 bg-transparent px-0 py-0 font-mono tabular-nums">
              {seriesSummary.total.toLocaleString()} report
              {seriesSummary.total === 1 ? '' : 's'}
              <span aria-hidden="true" className="mx-1">·</span>
              {seriesSummary.activeDays} active day
              {seriesSummary.activeDays === 1 ? '' : 's'}
            </InlineProof>
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
              <InlineProof className="tabular-nums border-0 bg-transparent px-0 py-0">
                {seriesSummary.avgPerActiveDay > 0 && (
                  <>
                    <SignalChip tone="neutral" className="font-mono">
                      {seriesSummary.avgPerActiveDay} / active day
                    </SignalChip>
                  </>
                )}
                {seriesSummary.peakDayLabel && seriesSummary.peakReports > 0 && (
                  <SignalChip tone="neutral" className="font-mono">
                    peak {seriesSummary.peakReports.toLocaleString()} on {seriesSummary.peakDayLabel}
                  </SignalChip>
                )}
                {seriesSummary.lastActiveDayLabel && seriesSummary.lastActiveDaysAgo != null && (
                  <SignalChip tone="neutral">
                    last activity{' '}
                    {seriesSummary.lastActiveDaysAgo === 0
                      ? 'today'
                      : seriesSummary.lastActiveDaysAgo === 1
                        ? 'yesterday'
                        : `${seriesSummary.lastActiveDaysAgo}d ago`}
                  </SignalChip>
                )}
              </InlineProof>
            </div>
          ) : (
            <EmptySectionMessage
              text="No reports ingested in the last 30 days."
              hint="Confirm the SDK is wired up and sending events to this project."
            />
          )}
        </section>
      )}

      {/* Secondary metrics — explicitly demoted below the quota block.
          They're useful but not what the user came here to read. */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-edge-subtle/60">
        <ContainedBlock tone="muted" className="flex flex-wrap items-center gap-1.5 py-1.5">
          <SignalChip tone="info">
            Fixes <span className="font-mono tabular-nums">{usage.fixes.toLocaleString()}</span>
          </SignalChip>
          <SignalChip tone="neutral">
            Classifier tokens <span className="font-mono tabular-nums">{usage.tokens.toLocaleString()}</span>
          </SignalChip>
          {llmCostUsd != null && (
            <span title="Real $ spent on LLM calls this billing month, from llm_invocations.cost_usd">
              <SignalChip tone="brand">
                LLM {formatLlmCost(llmCostUsd)}
              </SignalChip>
            </span>
          )}
        </ContainedBlock>
      </div>
    </section>
  )
}
