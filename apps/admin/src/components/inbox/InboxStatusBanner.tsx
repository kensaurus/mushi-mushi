/**
 * FILE: apps/admin/src/components/inbox/InboxStatusBanner.tsx
 * PURPOSE: Action inbox posture — open work, setup gaps, all-clear state.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { InboxStats, InboxTabId } from './types'

/** Nominal inbox-zero posture is covered by the page hero + snapshot. */
export function isInboxStatusBannerCritical(stats: InboxStats): boolean {
  if (!stats.hasAnyProject || stats.topPriority === 'no_project') return true
  if (stats.topPriority === 'setup') return true
  if (stats.topPriority === 'actions') return true
  return false
}

interface Props {
  stats: InboxStats
  onTab?: (tab: InboxTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function InboxStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/inbox')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (stats.topPriority === 'no_project' || !stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create your first app to see your to-do list' : 'No projects — inbox is empty'}
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Once setup is done, bugs and fixes show up here automatically.'
            : 'Create a project on Setup first. Actions appear here once reports and integrations are wired.')
        }
        action={
          <Link to={stats.nextStepTo ?? '/onboarding'}>
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'setup') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `Setup ${stats.requiredComplete} of ${stats.requiredTotal} done on ${projectLabel}`
            : `Setup incomplete on ${projectLabel} (${stats.requiredComplete}/${stats.requiredTotal})`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Finish setup — the inbox stays empty until bugs can arrive.'
            : 'Finish ingest before the inbox can surface real triage and fix actions.')
        }
        action={
          <Link to={stats.nextStepTo ?? '/onboarding?tab=steps'}>
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Continue setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'actions') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.openActions} thing${stats.openActions === 1 ? '' : 's'} need you`
            : `${stats.openActions} open action${stats.openActions === 1 ? '' : 's'} — start with ${stats.topPriorityStage ?? 'Plan'}`
        }
        subtitle={stats.topPriorityLabel ?? stats.topPriorityTitle ?? 'Work the queue top to bottom.'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {onTab ? (
              <Btn size="sm" variant="ghost" onClick={() => onTab('actions')}>
                {actions.queue ?? 'View queue'}
              </Btn>
            ) : null}
            {stats.topPriorityTo ? (
              <Link to={stats.topPriorityTo}>
                <Btn size="sm" variant="ghost">{actions.takeAction ?? 'Take action'}</Btn>
              </Link>
            ) : null}
          </div>
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={
        plainBanner
          ? 'Nothing waiting — you are caught up'
          : `Inbox zero — ${stats.clearStages}/${stats.totalSurfaces} stages clear`
      }
      subtitle={
        stats.topPriorityLabel ?? (
          <>
            {plainBanner
              ? 'New bugs and failed fixes will appear here automatically.'
              : 'No open actions across Plan, Do, Check, Act, or Ops'}
            {stats.lastActivityAt ? (
              <>
                {' '}
                · last activity <RelativeTime value={stats.lastActivityAt} />
              </>
            ) : null}
          </>
        )
      }
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('stages')}>
            {actions.stages ?? 'View stages'}
          </Btn>
        ) : null
      }
    />
  )
}
