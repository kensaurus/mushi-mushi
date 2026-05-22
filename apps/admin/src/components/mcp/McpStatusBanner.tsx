/**
 * FILE: apps/admin/src/components/mcp/McpStatusBanner.tsx
 * PURPOSE: Stats-driven MCP readiness banner for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="info"
        title="No project selected"
        subtitle="MCP keys and snippets are scoped to the active project in the header."
      />
    )
  }

  if (priority === 'endpoint_mismatch') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'MCP key hits the wrong server' : 'MCP key talking to a different backend'}
        subtitle={
          label ??
          `Last heartbeat hit ${stats.lastSeenEndpointHost} — expected ${stats.expectedEndpointHost}. Check MUSHI_API_ENDPOINT in your snippet.`
        }
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('setup')}>{actions.setup ?? 'Fix snippet'}</Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'report_only_keys') {
    return (
      <StatusBannerShell
        tone="brand"
        title={`${stats.reportOnlyKeyCount} SDK key${stats.reportOnlyKeyCount === 1 ? '' : 's'} — no MCP scope`}
        subtitle={
          label ??
          `report:write keys capture bugs but cannot list tools — mint mcp:read on /projects for ${projectLabel}.`
        }
        action={
          <Link to="/projects">
            <Btn size="sm" variant="primary">{actions.mint ?? 'Mint MCP key'}</Btn>
          </Link>
        }
      />
    )
  }

  if (priority === 'no_mcp_key') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No MCP keys yet' : `No MCP keys for ${projectLabel}`}
        subtitle={label}
        action={
          <Link to="/projects">
            <Btn size="sm" variant="primary">{actions.generate ?? 'Generate key'}</Btn>
          </Link>
        }
      />
    )
  }

  if (priority === 'never_connected') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.neverConnectedCount} MCP key${stats.neverConnectedCount === 1 ? '' : 's'} minted but never connected`}
        subtitle={label}
        action={
          onTab && actionTab ? (
            <Btn size="sm" variant="primary" onClick={() => onTab(actionTab)}>{actions.setup ?? 'Paste snippet'}</Btn>
          ) : (
            <Link to="/mcp?tab=setup">
              <Btn size="sm" variant="primary">{actions.setup ?? 'Paste snippet'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Your editor can talk to Mushi' : `Agent access live on ${projectLabel}`}
      subtitle={label}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('catalog')}>{actions.catalog ?? 'View catalog'}</Btn>
        ) : null
      }
    />
  )
}
