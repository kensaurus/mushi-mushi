/**
 * FILE: ExperimentsSnapshotStrip.tsx
 * PURPOSE: Experiments status: what is running and whether a version won
 *          (PageStatus, P1). With no experiments it is the page's one first
 *          step (PageFirstStep, P3), not six zero tiles.
 */

import { PageStatus } from '../ui'
import type { ExperimentsStats } from './ExperimentsStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { experimentsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: ExperimentsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Opens the create form: the first step on a project with no experiments. */
  onCreate?: () => void
}

function experimentsSentence(stats: ExperimentsStats): string {
  if (stats.totalExperiments === 0) return 'No experiments yet.'
  const parts: string[] = []
  if (stats.runningCount > 0) parts.push(`${pluralizeWithCount(stats.runningCount, 'experiment')} running`)
  if (stats.winnersFound > 0) parts.push(`${pluralizeWithCount(stats.winnersFound, 'clear winner')} found`)
  if (stats.draftsReadyToLaunch > 0) parts.push(`${stats.draftsReadyToLaunch} ready to start`)
  if (parts.length === 0) return `${pluralizeWithCount(stats.totalExperiments, 'experiment')}, none running.`
  const s = parts.join('; ')
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`
}

export function ExperimentsSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onCreate }: Props) {
  return (
    <PageStatus
      ariaLabel="Experiments status"
      tone={stats.winnersFound > 0 ? 'ok' : stats.runningCount > 0 ? 'info' : 'neutral'}
      sentence={experimentsSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.running ?? 'Running',
          value: stats.runningCount,
          tone: stats.runningCount > 0 ? 'info' : 'neutral',
          hint: 'Experiments splitting your users between versions right now.',
          to: experimentsLinks.running,
        },
        {
          label: statLabels?.winners ?? 'Winners',
          value: stats.winnersFound,
          tone: stats.winnersFound > 0 ? 'ok' : 'neutral',
          hint: 'Experiments where one version is clearly ahead, with enough users to trust it.',
          to: experimentsLinks.winners,
        },
        {
          label: statLabels?.readyToLaunch ?? 'Ready to start',
          value: stats.draftsReadyToLaunch,
          hint: 'Drafts with at least two versions, ready to start.',
          to: experimentsLinks.readyToLaunch,
        },
      ]}
      empty={
        stats.totalExperiments === 0
          ? {
              title: 'No experiments yet',
              sentence: 'Compare two versions of a screen and see which one more of your users finish.',
              action: onCreate ? { label: 'Create experiment', onClick: onCreate } : { label: 'Create experiment', to: '/experiments?tab=new' },
            }
          : undefined
      }
    />
  )
}
