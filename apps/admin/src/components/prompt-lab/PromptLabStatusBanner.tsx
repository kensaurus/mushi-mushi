/**
 * FILE: apps/admin/src/components/prompt-lab/PromptLabStatusBanner.tsx
 * PURPOSE: Prompt Lab posture — thin dataset, A/B untested, promote ready, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { PromptLabStats, PromptLabTabId } from './PromptLabStatsTypes'

interface Props {
  stats: PromptLabStats
  onTab?: (tab: PromptLabTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function PromptLabStatusBanner({ stats, onTab, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title="No projects — prompt lab idle"
        subtitle="Create a project before authoring prompt candidates."
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">Go to Setup</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'no_dataset') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`Thin eval dataset on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">Build dataset</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('dataset')}>
              Build dataset
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'untested_ab') {
    return (
      <StatusBannerShell
        tone="warn"
        pulseDot
        title="A/B running — no judge scores yet"
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">Open prompts</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('prompts')}>
              Open prompts
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'promote_ready') {
    return (
      <StatusBannerShell
        tone="ok"
        title="Candidate ready to promote"
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">Review & promote</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('prompts')}>
              Review & promote
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'candidates_idle') {
    return (
      <StatusBannerShell
        tone="brand"
        title="Candidates waiting for traffic"
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">Set traffic %</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('prompts')}>
              Set traffic %
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'ab_running') {
    return (
      <StatusBannerShell
        tone="info"
        pulseDot
        title="A/B tests in flight"
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">Monitor scores</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('prompts')}>
              Monitor scores
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`Prompt lab healthy on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            Refresh
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">View overview</Btn>
          </Link>
        ) : null
      }
    />
  )
}
