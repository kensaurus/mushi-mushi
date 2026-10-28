/**
 * FILE: SkillsSnapshotStrip.tsx
 * PURPOSE: Agent skills status: skill runs going now and the ones waiting on
 *          you (PageStatus, P1).
 */

import { PageStatus, formatRelative } from '../ui'
import type { SkillsStats } from './SkillsStatsTypes'
import { pluralizeWithCount } from '../../lib/format'

const skillsLinks = {
  catalog: '/skills?tab=catalog',
  activeRuns: '/skills?tab=pipelines',
  failedRuns: '/skills?tab=pipelines',
  awaitingCheckin: '/skills?tab=pipelines',
} as const

interface Props {
  stats: SkillsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function skillsSentence(stats: SkillsStats): string {
  const parts: string[] = []
  if (stats.activeRuns > 0) parts.push(`${pluralizeWithCount(stats.activeRuns, 'skill run')} going`)
  if (stats.awaitingCheckin > 0) {
    const since = stats.oldestAwaitingCheckinAt ? `, the oldest since ${formatRelative(stats.oldestAwaitingCheckinAt)}` : ''
    parts.push(`${pluralizeWithCount(stats.awaitingCheckin, 'step')} waiting for you to check in${since}`)
  }
  if (stats.failedRuns > 0) parts.push(`${stats.failedRuns} failed`)
  if (parts.length === 0) return `No skill runs going; ${pluralizeWithCount(stats.catalogTotal, 'skill')} to choose from.`
  const s = parts.join('; ')
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`
}

export function SkillsSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Agent skills status"
      tone={stats.failedRuns > 0 ? 'danger' : stats.awaitingCheckin > 0 ? 'warn' : stats.activeRuns > 0 ? 'info' : 'neutral'}
      sentence={skillsSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.activeRuns ?? 'Running',
          value: stats.activeRuns,
          tone: stats.activeRuns > 0 ? 'info' : 'neutral',
          hint: 'Skill runs working on a bug now.',
          to: skillsLinks.activeRuns,
        },
        {
          label: statLabels?.awaitingCheckin ?? 'Waiting for you',
          value: stats.awaitingCheckin,
          tone: stats.awaitingCheckin > 0 ? 'warn' : 'neutral',
          hint: 'Steps your editor finished that need you to mark them done or failed.',
          to: skillsLinks.awaitingCheckin,
        },
        {
          label: statLabels?.catalog ?? 'Skills',
          value: stats.catalogTotal,
          hint: 'Skills you can run on a bug.',
          to: skillsLinks.catalog,
        },
      ]}
    />
  )
}
