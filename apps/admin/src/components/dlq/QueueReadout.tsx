/**
 * FILE: QueueReadout.tsx
 * PURPOSE: Pipeline queue provenance — stats API ref and backlog/throughput signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /dlq (queue) with dead-letter and stall posture
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - QueueStats from ./QueueStatsTypes
 *
 * USAGE:
 * - Mount on DLQPage with stats from GET /v1/admin/queue/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { QueueStats } from './QueueStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: QueueStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function QueueReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/queue/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Backlog',
      value: `${stats.pending} pending · ${stats.running} running`,
      tone: stats.pending > 0 ? 'warn' : stats.running > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Dead letter / failed',
      value: `${stats.deadLetter} dead · ${stats.failed} failed`,
      tone: stats.deadLetter > 0 ? 'danger' : stats.failed > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Reports queued',
      value: `${stats.reportsQueued} queued · ${stats.strandedReports} stranded`,
      tone: stats.strandedReports > 0 ? 'danger' : stats.reportsQueued > 0 ? 'info' : 'muted',
    },
    {
      label: 'Oldest pending',
      value: stats.oldestPendingMinutes != null ? `${stats.oldestPendingMinutes} min` : '—',
      tone: stats.oldestPendingMinutes != null && stats.oldestPendingMinutes > 60 ? 'warn' : 'muted',
    },
    {
      label: 'Today',
      value: `${stats.todayCreated} created · ${stats.todayCompleted} done · ${stats.todayFailed} failed`,
      tone: stats.todayFailed > 0 ? 'warn' : 'info',
      wrap: true,
    },
    {
      label: 'Top stage (DLQ)',
      value: stats.topStage ? `${stats.topStage} (${stats.topStageDeadLetter})` : '—',
      mono: true,
      wrap: true,
      tone: stats.topStageDeadLetter > 0 ? 'danger' : 'muted',
    },
  ]

  return (
    <Section title="Queue readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Queue stats API" url={statsApi} />
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
