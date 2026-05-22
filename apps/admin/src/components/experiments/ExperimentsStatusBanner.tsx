/**
 * FILE: apps/admin/src/components/experiments/ExperimentsStatusBanner.tsx
 * PURPOSE: A/B experiment posture — no data, drafts ready, running, winners, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { ExperimentsStats, ExperimentsTabId } from './ExperimentsStatsTypes'

interface Props {
  stats: ExperimentsStats
  onTab?: (tab: ExperimentsTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function ExperimentsStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/experiments')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'A/B tests are per app — choose one in the header.'
            : 'Pick a project to create and monitor A/B experiments.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'running') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.runningCount} experiment${stats.runningCount === 1 ? '' : 's'} live`
            : `${stats.runningCount} experiment${stats.runningCount === 1 ? '' : 's'} live on ${projectLabel}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.monitor ?? 'Monitor runs'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('experiments')}>{actions.monitor ?? 'Monitor runs'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'draft_ready') {
    return (
      <StatusBannerShell
        tone="brand"
        title={`${stats.draftsReadyToLaunch} draft${stats.draftsReadyToLaunch === 1 ? '' : 's'} ready to launch`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.drafts ?? 'Review drafts'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('experiments')}>{actions.drafts ?? 'Review drafts'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'no_experiments') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No experiments yet' : `No experiments on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.create ?? 'Create experiment'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('new')}>{actions.create ?? 'Create experiment'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'winners_found') {
    return (
      <StatusBannerShell
        tone="ok"
        title={`${stats.winnersFound} winner${stats.winnersFound === 1 ? '' : 's'} declared`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.winners ?? 'Review winners'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('experiments')}>{actions.winners ?? 'Review winners'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'draft_incomplete') {
    return (
      <StatusBannerShell
        tone="warn"
        title="Draft experiments need variants"
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('experiments')}>{actions.finish ?? 'Finish setup'}</Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Experiment library idle' : `Experiment library idle on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.monitor ?? 'View experiments'}</Btn>
          </Link>
        ) : null
      }
    />
  )
}
