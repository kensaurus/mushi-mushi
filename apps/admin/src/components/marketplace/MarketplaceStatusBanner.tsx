/**
 * FILE: apps/admin/src/components/marketplace/MarketplaceStatusBanner.tsx
 * PURPOSE: Stats-driven plugin marketplace health for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { MarketplaceStats, MarketplaceTabId } from './types'

interface Props {
  stats: MarketplaceStats
  pluginsUnlocked: boolean
  onTab?: (tab: MarketplaceTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

function tabFromPath(path: string | null): MarketplaceTabId | null {
  if (!path) return null
  const tab = new URL(path, 'http://local').searchParams.get('tab')
  if (tab === 'browse' || tab === 'installed' || tab === 'deliveries' || tab === 'overview') return tab
  return null
}

export function MarketplaceStatusBanner({
  stats,
  pluginsUnlocked,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/marketplace')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle="Plugin installs and delivery logs are scoped to the active project."
      />
    )
  }

  if (!pluginsUnlocked) {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Plugins need a Pro plan' : 'Plugins require a Pro plan or higher'}
        subtitle="Browse the catalog read-only — installing webhook plugins needs the plugins entitlement."
        action={
          <Link to="/billing">
            <Btn size="sm" variant="ghost">{actions.plans ?? 'View plans'}</Btn>
          </Link>
        }
      />
    )
  }

  const priority = stats.topPriority
  const label = stats.topPriorityLabel
  const actionTab = tabFromPath(stats.topPriorityTo)

  if (priority === 'delivery_failures') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.deliveriesFailed} webhook failure${stats.deliveriesFailed === 1 ? '' : 's'} (7d)`
            : `${stats.deliveriesFailed} failed deliver${stats.deliveriesFailed === 1 ? 'y' : 'ies'} (7d)`
        }
        subtitle={label}
        action={
          onTab && actionTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab(actionTab)}>{actions.deliveries ?? 'View deliveries'}</Btn>
          ) : (
            <Link to="/marketplace?tab=deliveries">
              <Btn size="sm" variant="ghost">{actions.deliveries ?? 'View deliveries'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (priority === 'plugins_paused') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.installedPaused} plugin${stats.installedPaused === 1 ? '' : 's'} paused`}
        subtitle={label}
        action={
          onTab ? (
            <Btn size="sm" variant="primary" onClick={() => onTab('installed')}>{actions.resume ?? 'Resume plugins'}</Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'no_plugins_installed') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No plugins installed yet' : `No plugins installed on ${projectLabel}`}
        subtitle={label}
        action={
          onTab ? (
            <Btn size="sm" variant="primary" onClick={() => onTab('browse')}>{actions.browse ?? 'Browse catalog'}</Btn>
          ) : (
            <Link to="/marketplace?tab=browse">
              <Btn size="sm" variant="primary">{actions.browse ?? 'Browse catalog'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Plugins delivering' : `Plugins delivering on ${projectLabel}`}
      subtitle={label}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('deliveries')}>{actions.deliveries ?? 'View log'}</Btn>
        ) : null
      }
    />
  )
}
