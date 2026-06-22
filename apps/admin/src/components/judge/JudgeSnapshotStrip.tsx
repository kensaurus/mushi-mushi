/**
 * FILE: JudgeSnapshotStrip.tsx
 * PURPOSE: Dedicated judge KPI strip — replaces hand-rolled grid on JudgePage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { JudgeStats } from './JudgeStatsTypes'
import {
  classifiedDetail,
  classifiedTooltip,
  disagreeDetail,
  disagreeTooltip,
  driftDetail,
  driftTooltip,
  promptsDetail,
  promptsTooltip,
  totalDetail,
  totalTooltip,
  weekDetail,
  weekTooltip,
} from '../../lib/statTooltips/judge'
import { judgeLinks } from '../../lib/statCardLinks'

interface Props {
  stats: JudgeStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function JudgeSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'JUDGE SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Judge snapshot">
        <StatCard
          label={statLabels?.week ?? 'This week'}
          value={stats.latestWeekScore != null ? `${Math.round(stats.latestWeekScore * 100)}%` : '—'}
          accent={
            stats.latestWeekScore != null && stats.latestWeekScore >= 0.8
              ? 'text-ok'
              : stats.latestWeekScore != null && stats.latestWeekScore >= 0.6
                ? 'text-warn'
                : stats.latestWeekScore != null
                  ? 'text-danger'
                  : undefined
          }
          tooltip={weekTooltip(stats)}
          detail={weekDetail(stats)}
          to={judgeLinks.week}
        />
        <StatCard
          label={statLabels?.total ?? 'Total evals'}
          value={stats.totalEvaluations}
          accent={stats.totalEvaluations > 0 ? 'text-brand' : undefined}
          tooltip={totalTooltip(stats)}
          detail={totalDetail()}
          to={judgeLinks.total}
        />
        <StatCard
          label={statLabels?.disagree ?? 'Disagreements'}
          value={stats.disagreementCount}
          accent={stats.disagreementCount > 0 ? 'text-warn' : 'text-ok'}
          tooltip={disagreeTooltip(stats)}
          detail={disagreeDetail(stats)}
          to={judgeLinks.disagree}
        />
        <StatCard
          label={statLabels?.drift ?? 'WoW drift'}
          value={stats.weekOverWeekDriftPct != null ? `${stats.weekOverWeekDriftPct}%` : '—'}
          accent={
            stats.weekOverWeekDriftPct != null && stats.weekOverWeekDriftPct >= 5
              ? 'text-danger'
              : undefined
          }
          tooltip={driftTooltip(stats)}
          detail={driftDetail()}
          to={judgeLinks.drift}
        />
        <StatCard
          label={statLabels?.classified ?? 'Classified'}
          value={stats.classifiedReports}
          accent={stats.classifiedReports > 0 && stats.totalEvaluations === 0 ? 'text-brand' : undefined}
          tooltip={classifiedTooltip(stats)}
          detail={classifiedDetail()}
          to={judgeLinks.classified}
        />
        <StatCard
          label={statLabels?.prompts ?? 'Prompts'}
          value={stats.promptVersionCount}
          accent={stats.activePromptCount > 0 ? 'text-ok' : undefined}
          tooltip={promptsTooltip(stats)}
          detail={promptsDetail(stats)}
          to={judgeLinks.prompts}
        />
      </MetricStrip>
    </Section>
  )
}
