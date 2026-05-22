/**
 * FILE: apps/admin/src/components/inventory/InventoryStatusBanner.tsx
 * PURPOSE: User-story inventory posture — ingest, regressions, findings, clear.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { InventoryStats, InventoryTabId } from './InventoryStatsTypes'

interface Props {
  stats: InventoryStats
  onTab?: (tab: InventoryTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function InventoryStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/inventory')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project first' : 'No projects — inventory empty'}
        subtitle={
          plainBanner
            ? 'Screen maps are per app — set one up on Setup first.'
            : 'Create a project on Setup before mapping user stories.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (!stats.hasInventory) {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No screen map yet' : `No inventory on ${projectLabel}`}
        subtitle={
          stats.draftProposals > 0
            ? `${stats.draftProposals} draft proposal${stats.draftProposals === 1 ? '' : 's'} waiting on Discovery tab.`
            : stats.discoveryEvents > 0
              ? `${stats.discoveryEvents} SDK discovery events — generate a proposal or paste YAML.`
              : 'Install @mushi-mushi/web with discoverInventory or paste inventory.yaml.'
        }
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">
                {stats.draftProposals > 0 ? (actions.proposal ?? 'Review proposal') : (actions.discovery ?? 'Open Discovery')}
              </Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('discovery')}>
              {actions.discovery ?? 'Open Discovery'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'regressed') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.regressed} screen action${stats.regressed === 1 ? '' : 's'} broke`
            : `${stats.regressed} regressed action${stats.regressed === 1 ? '' : 's'}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.stories ?? 'View stories'}</Btn>
            </Link>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'open_findings') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.openFindings} quality check${stats.openFindings === 1 ? '' : 's'} to review`
            : `${stats.openFindings} open gate finding${stats.openFindings === 1 ? '' : 's'}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.gates ?? 'Open Gates'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('gates')}>
              {actions.gates ?? 'Open Gates'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'stub_heavy') {
    return (
      <StatusBannerShell
        tone="info"
        title={
          plainBanner
            ? `${stats.stub} action${stats.stub === 1 ? '' : 's'} still need wiring`
            : `${stats.stub} stub action${stats.stub === 1 ? '' : 's'} need wiring`
        }
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('tree')}>
              {actions.tree ?? 'Open Tree'}
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Screen map is up to date' : `Inventory current on ${projectLabel}`}
      subtitle={
        <>
          {stats.verified}/{stats.total} verified
          {stats.lastIngestAt ? (
            <> · ingested <RelativeTime value={stats.lastIngestAt} /></>
          ) : null}
        </>
      }
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('stories')}>
            {actions.stories ?? 'User stories'}
          </Btn>
        ) : null
      }
    />
  )
}
