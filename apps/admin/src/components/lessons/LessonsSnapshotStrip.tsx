/**
 * FILE: LessonsSnapshotStrip.tsx
 * PURPOSE: Lessons status: how many rules Mushi learned from your bugs and
 *          which recurring patterns are ready to become one (PageStatus, P1).
 */

import { Btn, PageStatus, toMetrics } from '../ui'
import type { LessonsStats, LessonsTabId } from './LessonsStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { lessonsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: LessonsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Opens the tab the lead's button names. */
  onTab?: (tab: LessonsTabId) => void
}

/** Where the lead's one button goes. */
export type LessonsLeadAction = { label: string; tab: 'clusters' | 'lessons' | 'query' } | null

/**
 * @internal Exported for tests. One line on what the rules do and how things stand, and the one
 * button that moves it on (console UX overhaul, 2026-11-19: "Patterns are still collecting
 * reports. Nothing to do yet." sat over 10 rules in use with nothing to press).
 */
export function lessonsLead(stats: LessonsStats): { sentence: string; action: LessonsLeadAction } {
  const rules = pluralizeWithCount(stats.activeLessons, 'rule')
  if (stats.readyToPromote > 0) {
    const ready = stats.readyToPromote === 1 ? '1 recurring bug is ready to become a rule' : `${stats.readyToPromote} recurring bugs are ready to become rules`
    return {
      sentence: `${stats.activeLessons > 0 ? `${rules} guide${stats.activeLessons === 1 ? 's' : ''} every new diagnosis and fix.` : 'Rules guide every new diagnosis and fix.'} ${ready}.`,
      action: { label: `Promote ${stats.readyToPromote}`, tab: 'clusters' },
    }
  }
  if (stats.criticalLessons > 0) {
    return {
      sentence: `${pluralizeWithCount(stats.criticalLessons, 'critical rule')} guide${stats.criticalLessons === 1 ? 's' : ''} every new diagnosis and fix. Retire any that no longer apply.`,
      action: { label: 'Review rules', tab: 'lessons' },
    }
  }
  if (stats.activeLessons > 0) {
    return {
      sentence: `${rules} guide${stats.activeLessons === 1 ? 's' : ''} every new diagnosis and fix. No recurring bug is ready to become a rule yet.`,
      action: { label: 'Try a change', tab: 'query' },
    }
  }
  if (stats.candidateClusters > 0) {
    // The tab's empty state already says how a rule is made (3 reports, one cause); say only
    // how things stand here, so the rule is never repeated on one screen.
    const growing = stats.candidateClusters === 1 ? '1 recurring pattern is' : `${stats.candidateClusters} recurring patterns are`
    return { sentence: `No rules yet. ${growing} still collecting reports.`, action: null }
  }
  return { sentence: 'No lessons yet. A bug pattern that keeps coming back across reports becomes one.', action: null }
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
  ]
    .filter((m) => m.value !== 0)
    // With one report per pattern, "2 in patterns" is the "2 patterns still growing" below said
    // again (2026-11-19): the reports count shows only when it says more than the pattern count.
    .filter((m) => m.label !== 'In patterns' || stats.totalClusterReports > stats.candidateClusters)
}

export function LessonsSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onTab }: Props) {
  const lead = lessonsLead(stats)
  return (
    <PageStatus
      ariaLabel="Lessons status"
      tone={stats.criticalLessons > 0 ? 'warn' : stats.readyToPromote > 0 ? 'info' : stats.activeLessons > 0 ? 'ok' : 'neutral'}
      sentence={lead.sentence}
      action={
        lead.action && onTab ? (
          <Btn size="sm" variant={lead.action.tab === 'query' ? 'ghost' : 'primary'} onClick={() => onTab(lead.action!.tab)} data-testid="lessons-lead-action">
            {lead.action.label}
          </Btn>
        ) : undefined
      }
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={toMetrics(lessonsMetrics(stats, statLabels))}
    />
  )
}
