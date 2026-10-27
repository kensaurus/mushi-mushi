/**
 * FILE: LessonsSnapshotStrip.tsx
 * PURPOSE: Lessons status: how many rules Mushi learned from your bugs and
 *          which recurring patterns are ready to become one (PageStatus, P1).
 */

import { PageStatus } from '../ui'
import type { LessonsStats } from './LessonsStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { lessonsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: LessonsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function lessonsSentence(stats: LessonsStats): string {
  if (stats.activeLessons === 0 && stats.candidateClusters === 0) {
    return 'No lessons yet. A bug pattern that keeps coming back across reports becomes one.'
  }
  const active = `${pluralizeWithCount(stats.activeLessons, 'lesson')} in use${stats.criticalLessons > 0 ? ` (${stats.criticalLessons} critical)` : ''}`
  const ready =
    stats.candidateClusters > 0
      ? `${pluralizeWithCount(stats.candidateClusters, 'recurring pattern')} ready to become one`
      : 'no new patterns waiting'
  return `${active}; ${ready}.`
}

export function LessonsSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Lessons status"
      tone={stats.criticalLessons > 0 ? 'warn' : stats.candidateClusters > 0 ? 'info' : 'ok'}
      sentence={lessonsSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.activeLessons ?? 'Lessons in use',
          value: stats.activeLessons,
          hint: 'Rules Mushi applies when it diagnoses a new report.',
          to: lessonsLinks.activeLessons,
        },
        {
          label: statLabels?.candidates ?? 'Ready to promote',
          value: stats.candidateClusters,
          tone: stats.candidateClusters > 0 ? 'warn' : 'neutral',
          hint: 'Groups of similar reports that could become a lesson. Promote one to apply it.',
          to: lessonsLinks.candidates,
        },
        {
          label: statLabels?.reportsClustered ?? 'Reports grouped',
          value: stats.totalClusterReports,
          hint: 'Reports that belong to a recurring pattern.',
          to: lessonsLinks.reportsClustered,
        },
      ]}
    />
  )
}
