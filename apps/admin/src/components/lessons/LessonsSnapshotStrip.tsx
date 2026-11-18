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

/**
 * @internal Exported for tests. The three numbers below already say how many; the sentence says
 * what to do next, so it never restates a count (fresh-eyes sweep 2026-11-18).
 */
export function lessonsSentence(stats: LessonsStats): string {
  if (stats.activeLessons === 0 && stats.candidateClusters === 0) {
    return 'No lessons yet. A bug pattern that keeps coming back across reports becomes one.'
  }
  if (stats.criticalLessons > 0) return `${pluralizeWithCount(stats.criticalLessons, 'critical lesson')} in use.`
  if (stats.readyToPromote > 0) return 'Promote a ready pattern to make its rule a lesson.'
  if (stats.candidateClusters > 0) return 'A pattern can become a rule once 3 reports share its cause.'
  return 'Mushi Mushi applies these rules to every new report.'
}

export function LessonsSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Lessons status"
      tone={stats.criticalLessons > 0 ? 'warn' : stats.readyToPromote > 0 ? 'info' : stats.activeLessons > 0 ? 'ok' : 'neutral'}
      sentence={lessonsSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.activeLessons ?? 'Lessons in use',
          value: stats.activeLessons,
          hint: 'Rules Mushi Mushi applies when it diagnoses a new report.',
          to: lessonsLinks.activeLessons,
        },
        {
          label: statLabels?.candidates ?? 'Ready to promote',
          value: stats.readyToPromote,
          tone: stats.readyToPromote > 0 ? 'warn' : 'neutral',
          hint: 'Bugs with 3 or more reports that share one cause. Promote one to make its suggested rule a rule in use.',
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
