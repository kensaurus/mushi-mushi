/**
 * FILE: CostSnapshotStrip.tsx
 * PURPOSE: LLM spend KPI strip using MetricStrip — replaces hand-rolled grids on CostPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { CostStats } from './types'
import {
  totalLoggedDetail,
  totalLoggedTooltip,
  spend24hDetail,
  spend24hTooltip,
  spendMonthDetail,
  spendMonthTooltip,
  topDriverDetail,
  topDriverTooltip,
  operationsDetail,
  operationsTooltip,
  modelsDetail,
  modelsTooltip,
  keySourceDetail,
  keySourceTooltip,
} from '../../lib/costStatTooltips'
import { costLinks } from '../../lib/statCardLinks'

function fmtSpend(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

interface Props {
  stats: CostStats
  fetchedAt: string | null
  isValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function CostSnapshotStrip({
  stats,
  fetchedAt,
  isValidating,
  sectionTitle = 'Spend snapshot',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <div className="space-y-2">
        <MetricStrip cols={4} ariaLabel="Spend snapshot primary">
          <StatCard
            label={statLabels?.total ?? 'Total logged'}
            value={fmtSpend(stats.totalSpendUsd)}
            accent={stats.totalSpendUsd > 0 ? 'text-brand' : undefined}
            tooltip={totalLoggedTooltip(stats)}
            detail={totalLoggedDetail(stats)}
            to={costLinks.totalLogged}
          />
          <StatCard
            label={statLabels?.day24h ?? '24h spend'}
            value={fmtSpend(stats.spend24hUsd)}
            accent={stats.spendSpike24h ? 'text-warn' : stats.spend24hUsd > 0 ? 'text-ok' : undefined}
            tooltip={spend24hTooltip(stats)}
            detail={spend24hDetail(stats)}
            to={costLinks.spend24h}
          />
          <StatCard
            label={statLabels?.month ?? 'This month'}
            value={fmtSpend(stats.spendMonthUsd)}
            accent="text-brand"
            tooltip={spendMonthTooltip(stats)}
            detail={spendMonthDetail(stats)}
            to={costLinks.spendMonth}
          />
          <StatCard
            label={statLabels?.topDriver ?? 'Top driver'}
            value={stats.topOperation ? stats.topOperation.split(':')[0] : '—'}
            accent={stats.topOperation ? 'text-info' : undefined}
            tooltip={topDriverTooltip(stats)}
            detail={topDriverDetail(stats)}
            to={costLinks.topDriver}
          />
        </MetricStrip>
        <MetricStrip cols={3} ariaLabel="Spend snapshot secondary">
          <StatCard
            label={statLabels?.operations ?? 'Operations'}
            value={stats.operationsCount}
            tooltip={operationsTooltip(stats)}
            detail={operationsDetail()}
            to={costLinks.operations}
          />
          <StatCard
            label={statLabels?.models ?? 'Models'}
            value={stats.modelsCount}
            tooltip={modelsTooltip(stats)}
            detail={modelsDetail(stats)}
            to={costLinks.models}
          />
          <StatCard
            label={statLabels?.keySource ?? 'Key source · 24h'}
            value={stats.byokCalls24h > 0 ? `${stats.byokCalls24h} BYOK` : `${stats.platformKeyCalls24h} platform`}
            accent={stats.byokAnthropicConfigured ? 'text-ok' : 'text-warn'}
            tooltip={keySourceTooltip(stats)}
            detail={keySourceDetail(stats)}
            to={costLinks.keySource}
          />
        </MetricStrip>
      </div>
    </Section>
  )
}
