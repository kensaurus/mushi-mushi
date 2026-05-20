/**
 * FILE: apps/admin/src/components/marketplace/MarketplaceStatusBanner.tsx
 * PURPOSE: Top-level plugin marketplace health for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { MarketplaceStats } from './types'

interface Props {
  stats: MarketplaceStats
  projectName: string | null
  pluginsUnlocked: boolean
}

export function MarketplaceStatusBanner({ stats, projectName, pluginsUnlocked }: Props) {
  if (!pluginsUnlocked) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Plugins require a Pro plan or higher</p>
            <p className="text-2xs text-fg-muted">
              You can browse the catalog, but installing webhook plugins needs the plugins entitlement.
            </p>
          </div>
        </div>
        <Link to="/billing">
          <Btn size="sm" variant="ghost">View plans</Btn>
        </Link>
      </div>
    )
  }

  if (stats.deliveriesFailed > 0 || stats.failingPlugins > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.deliveriesFailed} failed deliver{stats.deliveriesFailed === 1 ? 'y' : 'ies'} in the last 7 days
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.failingPlugins > 0
                ? `${stats.failingPlugins} plugin${stats.failingPlugins === 1 ? '' : 's'} with a failing last delivery — open Deliveries or send a test event.`
                : 'Check HTTP status and response excerpts in the Deliveries tab.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (stats.installedPaused > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.installedPaused} plugin{stats.installedPaused === 1 ? '' : 's'} paused
            </p>
            <p className="text-2xs text-fg-muted">
              Paused plugins stop receiving events until you resume them on the Installed tab.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (stats.installedTotal === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {projectName
                ? `No plugins installed for ${projectName} yet`
                : 'No plugins installed yet'}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.catalogTotal} plugin{stats.catalogTotal === 1 ? '' : 's'} in the catalog — install one to receive
              signed webhooks when reports classify or fixes land.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">Plugins delivering</p>
          <p className="text-2xs text-fg-muted">
            {stats.installedActive}/{stats.installedTotal} active · {stats.deliveriesOk} ok / {stats.deliveries7d} deliveries (7d)
            {projectName ? ` · ${projectName}` : ''}
          </p>
        </div>
      </div>
      {stats.lastDeliveryAt && (
        <span className="font-mono text-3xs text-fg-faint shrink-0">
          Last delivery {new Date(stats.lastDeliveryAt).toLocaleString()}
        </span>
      )}
    </div>
  )
}
