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
  spend24hTooltip,
  spendMonthTooltip,
  topDriverTooltip,
  operationsTooltip,
  keySourceTooltip,
} from '../../lib/costStatTooltips'
import { costLinks } from '../../lib/statCardLinks'
import { costTileDetails, formatSpendUsd as fmtSpend, keySourceView } from '../../lib/costView'

const KEY_SOURCE_ACCENT = { neutral: undefined, warn: 'text-warn', muted: 'text-fg-muted' } as const

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
  // Details stay short so they are whole in a 390px tile; the ⓘ has the rest.
  const details = costTileDetails(stats)
  const keySource = keySourceView(stats)
  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      {/* One flat row inside the card: seven bordered tiles sat in the bordered Summary card,
          the seventh alone on its row at 390 (2026-11-19). `panel--metrics` strips the tile
          chrome to hairline dividers; steps and models share one cell, so six cells pair up. */}
      <MetricStrip cols={6} ariaLabel="Spend snapshot" className="panel--metrics">
          <StatCard
            label={statLabels?.total ?? 'Total logged'}
            value={fmtSpend(stats.totalSpendUsd)}
            tooltip={totalLoggedTooltip(stats)}
            detail={totalLoggedDetail(stats)}
            to={costLinks.totalLogged}
          />
          <StatCard
            label={statLabels?.day24h ?? '24h spend'}
            value={fmtSpend(stats.spend24hUsd)}
            // A cost is ink, not green; amber only for a spike.
            accent={stats.spendSpike24h ? 'text-warn' : undefined}
            tooltip={spend24hTooltip(stats)}
            detail={details.spend24h}
            to={costLinks.spend24h}
          />
          <StatCard
            label={statLabels?.month ?? 'This month'}
            value={fmtSpend(stats.spendMonthUsd)}
            tooltip={spendMonthTooltip(stats)}
            detail={details.month}
            to={costLinks.spendMonth}
          />
          <StatCard
            label={statLabels?.topDriver ?? 'Top driver'}
            value={stats.topOperation ? stats.topOperation.split(':')[0] : '—'}
            tooltip={topDriverTooltip(stats)}
            detail={details.topDriver}
            to={costLinks.topDriver}
          />
          <StatCard
            label={statLabels?.operations ?? 'Steps · models'}
            value={`${stats.operationsCount} · ${stats.modelsCount}`}
            tooltip={operationsTooltip(stats)}
            detail={details.operations}
            to={costLinks.operations}
          />
          <StatCard
            label={statLabels?.keySource ?? 'Key source · 24h'}
            value={keySource.value}
            accent={KEY_SOURCE_ACCENT[keySource.tone]}
            tooltip={keySourceTooltip(stats)}
            detail={keySource.detail}
            to={costLinks.keySource}
          />
      </MetricStrip>
    </Section>
  )
}
