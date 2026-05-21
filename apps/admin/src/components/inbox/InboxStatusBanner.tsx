/**
 * FILE: apps/admin/src/components/inbox/InboxStatusBanner.tsx
 * PURPOSE: Action inbox posture — open work, setup gaps, all-clear state.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { InboxStats, InboxTabId } from './types'

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
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Create your first app to see your to-do list' : 'No projects — inbox is empty'}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Once setup is done, bugs and fixes show up here automatically.'
                  : 'Create a project on Setup first. Actions appear here once reports and integrations are wired.')}
            </p>
          </div>
        </div>
        <Link to={stats.nextStepTo ?? '/onboarding'}>
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'setup') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `Setup ${stats.requiredComplete} of ${stats.requiredTotal} done on ${projectLabel}`
                : `Setup incomplete on ${projectLabel} (${stats.requiredComplete}/${stats.requiredTotal})`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Finish setup — the inbox stays empty until bugs can arrive.'
                  : 'Finish ingest before the inbox can surface real triage and fix actions.')}
            </p>
          </div>
        </div>
        <Link to={stats.nextStepTo ?? '/onboarding?tab=steps'}>
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Continue setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'actions') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.openActions} thing${stats.openActions === 1 ? '' : 's'} need you`
                : `${stats.openActions} open action${stats.openActions === 1 ? '' : 's'} — start with ${stats.topPriorityStage ?? 'Plan'}`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ?? stats.topPriorityTitle ?? 'Work the queue top to bottom.'}
            </p>
          </div>
        </div>
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
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {plainBanner ? 'Nothing waiting — you are caught up' : `Inbox zero — ${stats.clearStages}/${stats.totalSurfaces} stages clear`}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.topPriorityLabel ?? (
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
            )}
          </p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          {actions.refresh ?? 'Refresh'}
        </Btn>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('stages')}>
          {actions.stages ?? 'View stages'}
        </Btn>
      ) : null}
    </div>
  )
}
