/**
 * FILE: apps/admin/src/components/integrations/IntegrationStatusBanner.tsx
 * PURPOSE: Top-level integration health summary for the active project.
 */

import { usePageCopy } from '../../lib/copy'
import { integrationIssuesHint, scopedHref } from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
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
  const pid = stats.projectId
  const priority = stats.topPriority ?? (stats.platformDown > 0 ? 'platform_down' : stats.platformConnected === 0 ? 'empty' : 'healthy')

  if (priority === 'platform_down' || stats.platformDown > 0) {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.platformDown} connection${stats.platformDown === 1 ? '' : 's'} failing on ${label}`
            : `${stats.platformDown} integration${stats.platformDown === 1 ? '' : 's'} failing health checks`
        }
        subtitle={stats.topPriorityLabel ?? integrationIssuesHint(stats.platformDown)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.platform ?? 'Fix connections'}
              to={stats.topPriorityTo}
              tone="danger"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.platform ?? 'Fix connections'}
              onClick={() => onTab('platform')}
              tone="danger"
            />
          ) : (
            <StatusBannerAction
              label={actions.health ?? 'Run health probe'}
              to={scopedHref('/health?fn=integration-probe', pid)}
              tone="danger"
            />
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
            : `${missing} integration${missing === 1 ? '' : 's'} missing credentials`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Add API keys on each card below, then click Test to confirm they work.'
            : `Finish credentials for ${label} on the cards below — fixes may not reach GitHub until GitHub is connected.`)
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.platform ?? 'Finish setup'}
              to={stats.topPriorityTo}
              tone="warn"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.platform ?? 'Finish setup'}
              onClick={() => onTab('platform')}
              tone="warn"
            />
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
          'Start with GitHub for auto-fix PRs, then add Sentry or Langfuse for richer context on each bug.'
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.platform ?? 'Connect GitHub'}
              to={stats.topPriorityTo}
              tone="info"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.platform ?? 'Connect GitHub'}
              onClick={() => onTab('platform')}
              tone="info"
            />
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
        `${stats.platformConnected}/${stats.platformTotal} platform tools connected · ${stats.routingActive} routing rule${stats.routingActive === 1 ? '' : 's'} active`
      }
      action={
        stats.topPriorityTo ? (
          <StatusBannerAction label={actions.repo ?? 'Check repo index'} to={stats.topPriorityTo} tone="ok" />
        ) : stats.lastProbeAt ? (
          <span className="shrink-0 font-mono text-3xs text-fg-faint">Last probe recorded</span>
        ) : null
      }
    />
  )
}
