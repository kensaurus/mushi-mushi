/**
 * FILE: BillingSnapshotStrip.tsx
 * PURPOSE: Billing KPI strip using MetricStrip — replaces hand-rolled StatCard grid on BillingPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import { formatLlmCost } from '../../lib/format'
import {
  fixesPeriodDetail,
  fixesPeriodTooltip,
  llmCogsDetail,
  llmCogsTooltip,
  planDetail,
  planTooltip,
  reportsPeriodDetail,
  reportsPeriodTooltip,
} from '../../lib/statTooltips/billing'
import { billingLinks } from '../../lib/statCardLinks'
import type { BillingStats } from './types'

interface Props {
  stats: BillingStats
  fetchedAt: string | null
  isValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function BillingSnapshotStrip({
  stats,
  fetchedAt,
  isValidating,
  sectionTitle = 'Billing snapshot',
  hint,
  statLabels,
}: Props) {
  const diagnosesLimit = stats.diagnosesLimit ?? null
  const diagnosesUsed = stats.diagnosesUsed ?? null
  const monthlySpendCapUsd = stats.monthlySpendCapUsd ?? null

  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Billing snapshot">
        <StatCard
          label={statLabels?.plan ?? 'Plan'}
          value={stats.planDisplayName}
          accent={
            stats.isComplimentary
              ? 'text-brand'
              : stats.planId === 'hobby' || stats.planId === 'free_cloud'
                ? undefined
                : 'text-ok'
          }
          tooltip={planTooltip(stats)}
          detail={planDetail(stats)}
          to={billingLinks.plan}
        />
        {diagnosesLimit != null ? (
          <StatCard
            label="Diagnoses · period"
            value={
              diagnosesLimit != null && diagnosesUsed != null
                ? `${diagnosesUsed.toLocaleString()} / ${diagnosesLimit.toLocaleString()}`
                : (diagnosesUsed ?? 0).toLocaleString()
            }
            accent={
              stats.overDiagnosisQuota
                ? 'text-danger'
                : stats.approachingDiagnosisQuota
                  ? 'text-warn'
                  : 'text-ok'
            }
            tooltip="Completed AI diagnoses (Stage-2 classifications) this billing period."
            detail={
              stats.diagnosesUsagePct != null ? `${stats.diagnosesUsagePct}% used` : undefined
            }
            to={billingLinks.reportsPeriod}
          />
        ) : (
          <StatCard
            label={statLabels?.reports ?? 'Reports · period'}
            value={
              stats.reportsLimit != null
                ? `${stats.reportsUsed.toLocaleString()} / ${stats.reportsLimit.toLocaleString()}`
                : stats.reportsUsed.toLocaleString()
            }
            accent={stats.overQuota ? 'text-danger' : stats.approachingQuota ? 'text-warn' : 'text-ok'}
            tooltip={reportsPeriodTooltip(stats)}
            detail={reportsPeriodDetail(stats)}
            to={billingLinks.reportsPeriod}
          />
        )}
        <StatCard
          label={statLabels?.fixes ?? 'Fixes · period'}
          value={`${stats.fixesSucceeded}/${stats.fixesAttempted}`}
          accent={stats.fixesAttempted > 0 ? 'text-info' : undefined}
          tooltip={fixesPeriodTooltip(stats)}
          detail={fixesPeriodDetail()}
          to={billingLinks.fixesPeriod}
        />
        {monthlySpendCapUsd != null ? (
          <StatCard
            label="Spend cap · month"
            value={`$${monthlySpendCapUsd}`}
            accent="text-brand"
            tooltip="Hard monthly spend cap. Diagnoses pause when overage cost hits this limit — no surprise charges."
            detail="Anti-surprise guard"
            to={billingLinks.plan}
          />
        ) : (
          <StatCard
            label={statLabels?.llmCogs ?? 'LLM COGS · month'}
            value={stats.llmCostUsdMonth > 0 ? formatLlmCost(stats.llmCostUsdMonth) : '$0'}
            accent={stats.llmCostUsdMonth > 0 ? 'text-brand' : undefined}
            tooltip={llmCogsTooltip(stats)}
            detail={llmCogsDetail(stats)}
            to={billingLinks.llmCogs}
          />
        )}
      </MetricStrip>
    </Section>
  )
}
