/**
 * FILE: apps/admin/src/components/marketplace/MarketplaceStatusBanner.tsx
 * PURPOSE: Stats-driven plugin marketplace health for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { MarketplaceStats, MarketplaceTabId } from './types'

interface Props {
  stats: MarketplaceStats
  pluginsUnlocked: boolean
  onTab?: (tab: MarketplaceTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

function tabFromPath(path: string | null): MarketplaceTabId | null {
  if (!path) return null
  const tab = new URL(path, 'http://local').searchParams.get('tab')
  if (tab === 'browse' || tab === 'installed' || tab === 'deliveries' || tab === 'overview') return tab
  return null
}

export function MarketplaceStatusBanner({ stats, pluginsUnlocked, onTab, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No project selected</p>
            <p className="text-2xs text-fg-muted">Plugin installs and delivery logs are scoped to the active project.</p>
          </div>
        </div>
      </div>
    )
  }

  if (!pluginsUnlocked) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Plugins require a Pro plan or higher</p>
            <p className="text-2xs text-fg-muted">Browse the catalog read-only — installing webhook plugins needs the plugins entitlement.</p>
          </div>
        </div>
        <Link to="/billing">
          <Btn size="sm" variant="ghost">View plans</Btn>
        </Link>
      </div>
    )
  }

  const priority = stats.topPriority
  const label = stats.topPriorityLabel
  const actionTab = tabFromPath(stats.topPriorityTo)

  if (priority === 'delivery_failures') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.deliveriesFailed} failed deliver{stats.deliveriesFailed === 1 ? 'y' : 'ies'} (7d)
            </p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab && actionTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab(actionTab)}>View deliveries</Btn>
        ) : (
          <Link to="/marketplace?tab=deliveries">
            <Btn size="sm" variant="ghost">View deliveries</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (priority === 'plugins_paused') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.installedPaused} plugin{stats.installedPaused === 1 ? '' : 's'} paused
            </p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab('installed')}>Resume plugins</Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'no_plugins_installed') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">No plugins installed on {projectLabel}</p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab('browse')}>Browse catalog</Btn>
        ) : (
          <Link to="/marketplace?tab=browse">
            <Btn size="sm" variant="primary">Browse catalog</Btn>
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">Plugins delivering on {projectLabel}</p>
          <p className="text-2xs text-fg-muted">{label}</p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          Refresh
        </Btn>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('deliveries')}>View log</Btn>
      ) : null}
    </div>
  )
}
