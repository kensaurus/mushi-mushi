/**
 * FILE: apps/admin/src/components/mcp/McpStatusBanner.tsx
 * PURPOSE: Stats-driven MCP readiness banner for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { McpStats, McpTabId } from './types'

interface Props {
  stats: McpStats
  onTab?: (tab: McpTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

function tabFromPath(path: string | null): McpTabId | null {
  if (!path) return null
  const tab = new URL(path, 'http://local').searchParams.get('tab')
  if (tab === 'setup' || tab === 'catalog' || tab === 'examples' || tab === 'overview') return tab
  return null
}

export function McpStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/mcp')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'active project'
  const priority = stats.topPriority
  const label = stats.topPriorityLabel
  const actionTab = tabFromPath(stats.topPriorityTo)

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No project selected</p>
            <p className="text-2xs text-fg-muted">MCP keys and snippets are scoped to the active project in the header.</p>
          </div>
        </div>
      </div>
    )
  }

  if (priority === 'endpoint_mismatch') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'MCP key hits the wrong server' : 'MCP key talking to a different backend'}
            </p>
            <p className="text-2xs text-fg-muted">
              {label ??
                `Last heartbeat hit ${stats.lastSeenEndpointHost} — expected ${stats.expectedEndpointHost}. Check MUSHI_API_ENDPOINT in your snippet.`}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('setup')}>{actions.setup ?? 'Fix snippet'}</Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'report_only_keys') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {stats.reportOnlyKeyCount} SDK key{stats.reportOnlyKeyCount === 1 ? '' : 's'} — no MCP scope
            </p>
            <p className="text-2xs text-fg-muted">
              {label ??
                `report:write keys capture bugs but cannot list tools — mint mcp:read on /projects for ${projectLabel}.`}
            </p>
          </div>
        </div>
        <Link to="/projects">
          <Btn size="sm" variant="primary">{actions.mint ?? 'Mint MCP key'}</Btn>
        </Link>
      </div>
    )
  }

  if (priority === 'no_mcp_key') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'No MCP keys yet' : `No MCP keys for ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        <Link to="/projects">
          <Btn size="sm" variant="primary">{actions.generate ?? 'Generate key'}</Btn>
        </Link>
      </div>
    )
  }

  if (priority === 'never_connected') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.neverConnectedCount} MCP key{stats.neverConnectedCount === 1 ? '' : 's'} minted but never connected
            </p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab && actionTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab(actionTab)}>{actions.setup ?? 'Paste snippet'}</Btn>
        ) : (
          <Link to="/mcp?tab=setup">
            <Btn size="sm" variant="primary">{actions.setup ?? 'Paste snippet'}</Btn>
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
          <p className="text-xs font-medium text-ok">
            {plainBanner ? 'Your editor can talk to Mushi' : `Agent access live on ${projectLabel}`}
          </p>
          <p className="text-2xs text-fg-muted">{label}</p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          {actions.refresh ?? 'Refresh'}
        </Btn>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('catalog')}>{actions.catalog ?? 'View catalog'}</Btn>
      ) : null}
    </div>
  )
}
