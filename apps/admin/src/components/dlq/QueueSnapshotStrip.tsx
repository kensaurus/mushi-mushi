/**
 * FILE: QueueSnapshotStrip.tsx
 * PURPOSE: Queue pipeline KPI strip using MetricStrip + StatCard — simpler snapshot than QueueKpiRow sparklines.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { QueueStats } from './QueueStatsTypes'

const queueLinks = {
  pending: '/dlq',
  running: '/dlq',
  completed: '/dlq',
  failed: '/dlq',
  deadLetter: '/dlq',
} as const

interface Props {
  stats: QueueStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function QueueSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'QUEUE SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={5} ariaLabel="Queue snapshot">
        <StatCard
          label={statLabels?.pending ?? 'Pending'}
          value={stats.pending}
          accent={stats.pending > 0 ? 'text-info' : undefined}
          hint="Jobs queued but not yet picked up by a worker."
          detail="waiting for worker"
          to={queueLinks.pending}
        />
        <StatCard
          label={statLabels?.running ?? 'Running'}
          value={stats.running}
          accent={stats.running > 0 ? 'text-brand' : undefined}
          hint="Jobs currently being processed."
          detail="in flight now"
          to={queueLinks.running}
        />
        <StatCard
          label={statLabels?.completed ?? 'Completed'}
          value={stats.completed}
          accent="text-ok"
          hint="Jobs that finished successfully."
          detail="all-time success"
          to={queueLinks.completed}
        />
        <StatCard
          label={statLabels?.failed ?? 'Failed'}
          value={stats.failed}
          accent={stats.failed > 0 ? 'text-warn' : undefined}
          hint="Jobs that errored but will be retried automatically."
          detail="still inside retry budget"
          to={queueLinks.failed}
        />
        <StatCard
          label={statLabels?.deadLetter ?? 'Dead letter'}
          value={stats.deadLetter}
          accent={stats.deadLetter > 0 ? 'text-danger' : undefined}
          hint="Jobs that exceeded their retry budget — manual replay required."
          detail="exhausted retries"
          to={queueLinks.deadLetter}
        />
      </MetricStrip>
    </Section>
  )
}
