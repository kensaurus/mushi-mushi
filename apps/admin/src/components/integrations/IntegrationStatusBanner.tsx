/**
 * FILE: apps/admin/src/components/integrations/IntegrationStatusBanner.tsx
 * PURPOSE: Top-level integration health summary for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.platformDown} connection${stats.platformDown === 1 ? '' : 's'} failing on ${label}`
            : `${stats.platformDown} platform probe${stats.platformDown === 1 ? '' : 's'} failing`
        }
        subtitle={
          stats.topPriorityLabel ??
          'Auto-fix and classification degrade without healthy Sentry, Langfuse, or GitHub wiring.'
        }
        action={
          stats.topPriorityTo ? (
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
          )
        }
      />
    )
  }

  if (priority === 'incomplete') {
    const missing = stats.platformTotal - stats.platformConnected
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${missing} service${missing === 1 ? '' : 's'} still need credentials`
            : `${missing} platform integration${missing === 1 ? '' : 's'} incomplete`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Add keys on each card below, then click Test.'
            : `Finish credentials for ${label} on the cards below, then click Test on each.`)
        }
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.platform ?? 'Finish setup'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('platform')}>
              {actions.platform ?? 'Finish setup'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'empty' || (stats.platformConnected === 0 && stats.routingActive === 0)) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? `No tools connected for ${label}` : `No integrations wired for ${label}`}
        subtitle={
          stats.topPriorityLabel ??
          'Start with GitHub for auto-fix PRs, Langfuse for trace links, and Sentry for production context.'
        }
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.platform ?? 'Connect GitHub'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('platform')}>
              {actions.platform ?? 'Connect GitHub'}
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? `Tools connected on ${label}` : 'Integrations healthy'}
      subtitle={
        stats.topPriorityLabel ??
        `${stats.platformConnected}/${stats.platformTotal} platform · ${stats.routingActive} routing destination${stats.routingActive === 1 ? '' : 's'} active`
      }
      action={
        stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.repo ?? 'Check repo index'}</Btn>
          </Link>
        ) : stats.lastProbeAt ? (
          <span className="shrink-0 font-mono text-3xs text-fg-faint">Last probe recorded</span>
        ) : null
      }
    />
  )
}
