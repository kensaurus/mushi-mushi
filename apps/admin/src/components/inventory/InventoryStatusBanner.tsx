/**
 * FILE: apps/admin/src/components/inventory/InventoryStatusBanner.tsx
 * PURPOSE: User-story inventory posture — ingest, regressions, findings, clear.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { InventoryStats, InventoryTabId } from './InventoryStatsTypes'

interface Props {
  stats: InventoryStats
  onTab?: (tab: InventoryTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function InventoryStatusBanner({ stats, onTab, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No projects — inventory empty</p>
            <p className="text-2xs text-fg-muted">Create a project on Setup before mapping user stories.</p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">Go to Setup</Btn>
        </Link>
      </div>
    )
  }

  if (!stats.hasInventory) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">No inventory on {projectLabel}</p>
            <p className="text-2xs text-fg-muted">
              {stats.draftProposals > 0
                ? `${stats.draftProposals} draft proposal${stats.draftProposals === 1 ? '' : 's'} waiting on Discovery tab.`
                : stats.discoveryEvents > 0
                  ? `${stats.discoveryEvents} SDK discovery events — generate a proposal or paste YAML.`
                  : 'Install @mushi-mushi/web with discoverInventory or paste inventory.yaml.'}
            </p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">
              {stats.draftProposals > 0 ? 'Review proposal' : 'Open Discovery'}
            </Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('discovery')}>
            Open Discovery
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'regressed') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.regressed} regressed action{stats.regressed === 1 ? '' : 's'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">View stories</Btn>
          </Link>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'open_findings') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.openFindings} open gate finding{stats.openFindings === 1 ? '' : 's'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">Open Gates</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('gates')}>
            Open Gates
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'stub_heavy') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {stats.stub} stub action{stats.stub === 1 ? '' : 's'} need wiring
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('tree')}>
            Open Tree
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
          <p className="text-xs font-medium text-ok">Inventory current on {projectLabel}</p>
          <p className="text-2xs text-fg-muted">
            {stats.verified}/{stats.total} verified
            {stats.lastIngestAt ? (
              <> · ingested <RelativeTime value={stats.lastIngestAt} /></>
            ) : null}
          </p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          Refresh
        </Btn>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('stories')}>
          User stories
        </Btn>
      ) : null}
    </div>
  )
}
