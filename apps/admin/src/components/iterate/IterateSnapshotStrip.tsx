/**
 * FILE: IterateSnapshotStrip.tsx
 * PURPOSE: Improvement runs status (PageStatus, P1). With no runs it is the
 *          page's one first step (PageFirstStep, P3) instead of six zeros.
 */

import { PageStatus } from '../ui'
import type { IterateStats } from './IterateStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { iterateLinks } from '../../lib/statCardLinks'

interface Props {
  stats: IterateStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function iterateSentence(stats: IterateStats, active: number): string {
  const parts = [`${pluralizeWithCount(stats.total, 'improvement run')}`]
  const detail: string[] = []
  if (active > 0) detail.push(`${active} running`)
  if (stats.succeeded > 0) detail.push(`${stats.succeeded} passed`)
  if (stats.failed > 0) detail.push(`${stats.failed} failed`)
  if (stats.avgFinalScorePct != null) detail.push(`average score ${stats.avgFinalScorePct}%`)
  return `${parts[0]}${detail.length ? `: ${detail.join(', ')}` : ''}.`
}

export function IterateSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  const active = stats.running + stats.queued
  return (
    <PageStatus
      ariaLabel="Improvement runs status"
      tone={stats.failed > 0 ? 'warn' : active > 0 ? 'info' : 'ok'}
      sentence={iterateSentence(stats, active)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        { label: statLabels?.active ?? 'Running', value: active, tone: active > 0 ? 'info' : 'neutral', to: iterateLinks.active },
        { label: statLabels?.succeeded ?? 'Passed', value: stats.succeeded, tone: stats.succeeded > 0 ? 'ok' : 'neutral', to: iterateLinks.succeeded },
        { label: statLabels?.failed ?? 'Failed', value: stats.failed, tone: stats.failed > 0 ? 'danger' : 'neutral', to: iterateLinks.failed },
      ]}
      empty={{
        title: 'No improvement runs yet',
        sentence: 'Give Mushi one page of your app: an AI drafts a change and a second AI critiques it until it passes.',
        action: { label: 'Start a run', to: '/iterate?tab=new' },
      }}
    />
  )
}
