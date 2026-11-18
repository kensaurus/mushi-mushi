/**
 * FILE: LessonsSnapshotStrip.tsx
 * PURPOSE: Lessons status: how many rules Mushi learned from your bugs and
 *          which recurring patterns are ready to become one (PageStatus, P1).
 */

import { PageStatus, toMetrics } from '../ui'
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
function lessonsSentence(stats: LessonsStats): string {
  if (stats.activeLessons === 0 && stats.candidateClusters === 0) {
    return 'No lessons yet. A bug pattern that keeps coming back across reports becomes one.'
  }
  if (stats.criticalLessons > 0) return `${pluralizeWithCount(stats.criticalLessons, 'critical lesson')} in use.`
  if (stats.readyToPromote > 0) return 'Promote a ready pattern to make its rule a lesson.'
  // The 3-report threshold is stated once, by the empty state and the hints.
  if (stats.candidateClusters > 0) return 'Patterns are still collecting reports. Nothing to do yet.'
  return 'Mushi Mushi applies these rules to every new report.'
}

/** Nothing learned, nothing growing, no reports in a pattern: the tab's empty state speaks instead. */
export function lessonsNothingYet(stats: LessonsStats): boolean {
  return stats.hasAnyProject && stats.activeLessons === 0 && stats.candidateClusters === 0 && stats.totalClusterReports === 0
}

/**
 * Only the numbers that are not 0 show (round-2
 * sweep: a row of 0/0 tiles), and the labels fit a third of a 390px phone
 * without being cut ("Ready to pr…", "Reports gro…").
 */
function lessonsMetrics(stats: LessonsStats, statLabels?: Record<string, string>) {
  return [
    {
      label: statLabels?.activeLessons ?? 'Lessons in use',
      value: stats.activeLessons,
      hint: 'Rules Mushi Mushi applies when it diagnoses a new report.',
      to: lessonsLinks.activeLessons,
    },
    {
      // Fixed short labels: lib/copy.ts still says "Ready to promote" /
      // "Reports grouped", which a 390px third cuts mid-word.
      label: 'To promote',
      value: stats.readyToPromote,
      tone: stats.readyToPromote > 0 ? ('warn' as const) : ('neutral' as const),
      hint: 'Bugs with 3 or more reports that share one cause. Promote one to make its suggested rule a rule in use.',
      to: lessonsLinks.candidates,
    },
    {
      label: 'In patterns',
      value: stats.totalClusterReports,
      hint: 'Reports that belong to a recurring pattern.',
      to: lessonsLinks.reportsClustered,
    },
  ].filter((m) => m.value !== 0)
}

export function LessonsSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Lessons status"
      tone={stats.criticalLessons > 0 ? 'warn' : stats.readyToPromote > 0 ? 'info' : stats.activeLessons > 0 ? 'ok' : 'neutral'}
      sentence={lessonsSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={toMetrics(lessonsMetrics(stats, statLabels))}
    />
  )
}
