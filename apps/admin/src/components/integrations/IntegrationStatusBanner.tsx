/**
 * FILE: apps/admin/src/components/integrations/IntegrationStatusBanner.tsx
 * PURPOSE: Top-level integration health summary for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { IntegrationStats } from './types'

interface Props {
  stats: IntegrationStats
  projectName: string | null
  plainBanner?: boolean
  onTab?: (tab: 'platform' | 'routing' | 'repo') => void
}

export function IntegrationStatusBanner({
  stats,
  projectName,
  plainBanner = false,
  onTab,
}: Props) {
  const copy = usePageCopy('/integrations/config')
  const actions = copy?.actionLabels ?? {}
  const label = stats.projectName ?? projectName ?? 'workspace'
  const priority = stats.topPriority ?? (stats.platformDown > 0 ? 'platform_down' : stats.platformConnected === 0 ? 'empty' : 'healthy')

  if (priority === 'platform_down' || stats.platformDown > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.platformDown} connection${stats.platformDown === 1 ? '' : 's'} failing on ${label}`
                : `${stats.platformDown} platform probe${stats.platformDown === 1 ? '' : 's'} failing`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                'Auto-fix and classification degrade without healthy Sentry, Langfuse, or GitHub wiring.'}
            </p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.platform ?? 'Fix platform'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('platform')}>
            {actions.platform ?? 'Fix platform'}
          </Btn>
        ) : (
          <Link to="/health?fn=integration-probe">
            <Btn size="sm" variant="ghost">{actions.health ?? 'Open health'}</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (priority === 'incomplete') {
    const missing = stats.platformTotal - stats.platformConnected
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `${missing} service${missing === 1 ? '' : 's'} still need credentials`
                : `${missing} platform integration${missing === 1 ? '' : 's'} incomplete`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Add keys on each card below, then click Test.'
                  : `Finish credentials for ${label} on the cards below, then click Test on each.`)}
            </p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.platform ?? 'Finish setup'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('platform')}>
            {actions.platform ?? 'Finish setup'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'empty' || (stats.platformConnected === 0 && stats.routingActive === 0)) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? `No tools connected for ${label}` : `No integrations wired for ${label}`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                'Start with GitHub for auto-fix PRs, Langfuse for trace links, and Sentry for production context.'}
            </p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.platform ?? 'Connect GitHub'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('platform')}>
            {actions.platform ?? 'Connect GitHub'}
          </Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {plainBanner ? `Tools connected on ${label}` : 'Integrations healthy'}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.topPriorityLabel ??
              `${stats.platformConnected}/${stats.platformTotal} platform · ${stats.routingActive} routing destination${stats.routingActive === 1 ? '' : 's'} active`}
          </p>
        </div>
      </div>
      {stats.topPriorityTo ? (
        <Link to={stats.topPriorityTo}>
          <Btn size="sm" variant="ghost">{actions.repo ?? 'Check repo index'}</Btn>
        </Link>
      ) : stats.lastProbeAt ? (
        <span className="font-mono text-3xs text-fg-faint shrink-0">
          Last probe recorded
        </span>
      ) : null}
    </div>
  )
}
