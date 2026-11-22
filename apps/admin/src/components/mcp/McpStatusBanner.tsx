/**
 * FILE: apps/admin/src/components/mcp/McpStatusBanner.tsx
 * PURPOSE: Stats-driven MCP readiness banner for the active project.
 */

import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusGlyph } from '../signal/StatusGlyph'
import type { McpStats, McpTabId } from './types'

/**
 * Lands on Your projects at the app's mint control with the mcp:read preset
 * chosen, as the copy says. A bare /projects opened Overview with "SDK
 * ingest" preselected, so following the banner minted another SDK-only key
 * and the banner stayed (QA bug 132).
 */
export function mintMcpKeyHref(projectId?: string | null): string {
  const base = '/projects?tab=list&keyScope=mcp-read'
  return projectId ? `${base}&project=${encodeURIComponent(projectId)}#mint-key-${projectId}` : base
}

interface Props {
  stats: McpStats
  onTab?: (tab: McpTabId) => void
  plainBanner?: boolean
  /** An account key that already reaches this app (lib/mcpSetupView.ts accountKeyForProject). */
  accountKey?: { label: string | null } | null
}

function tabFromPath(path: string | null): McpTabId | null {
  if (!path) return null
  const tab = new URL(path, 'http://local').searchParams.get('tab')
  if (tab === 'setup' || tab === 'catalog' || tab === 'examples' || tab === 'overview') return tab
  return null
}

export function McpStatusBanner({ stats, onTab, plainBanner = false, accountKey = null }: Props) {
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
          `This key last checked in with ${stats.lastSeenEndpointHost}, not ${stats.expectedEndpointHost}. Check MUSHI_API_ENDPOINT in your snippet.`
        }
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('setup')}>{actions.setup ?? 'Fix snippet'}</Btn>
          ) : null
        }
      />
    )
  }

  // An account key already reaches this app: no "Mint MCP key" (round-2
  // review 2026-11-18). The next step is pasting it into an editor.
  if (accountKey && (priority === 'report_only_keys' || priority === 'no_mcp_key')) {
    return (
      <div
        className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-xs text-fg-secondary"
        data-testid="mcp-account-key-line"
      >
        <p className="flex min-w-0 items-center gap-2">
          <StatusGlyph tone="off" />
          <span className="min-w-0">
            Your account key <span className="font-medium text-fg">{accountKey.label ?? 'Account key'}</span> reaches
            this app. Editors can use it.
          </span>
        </p>
        {onTab ? (
          // Not the copy's "Fix snippet": nothing is wrong with the snippet here (round-3 review 2026-11-19).
          <Btn size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={() => onTab('setup')}>
            Paste snippet
          </Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'report_only_keys') {
    // SDK keys are normal: they send bug reports. Not a failure, so a plain
    // ○ line, not a coloured banner ("4 SDK keys — no MCP scope" in red).
    const n = stats.reportOnlyKeyCount
    return (
      <div
        className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-xs text-fg-secondary"
        data-testid="mcp-sdk-keys-line"
      >
        <p className="flex min-w-0 items-center gap-2">
          <StatusGlyph tone="off" />
          <span className="min-w-0">
            {n} SDK {n === 1 ? 'key sends' : 'keys send'} bug reports. Editors need an MCP key.
          </span>
        </p>
        <Btn to={mintMcpKeyHref(stats.projectId)} size="sm" variant="ghost" className="shrink-0 whitespace-nowrap">
          {actions.mint ?? 'Mint MCP key'}
        </Btn>
      </div>
    )
  }

  if (priority === 'no_mcp_key') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No MCP keys yet' : `No MCP keys for ${projectLabel}`}
        subtitle={label}
        action={
          <Btn to={mintMcpKeyHref(stats.projectId)} size="sm" variant="primary">{actions.generate ?? 'Generate key'}</Btn>
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
            <Btn to="/mcp?tab=setup" size="sm" variant="primary">{actions.setup ?? 'Paste snippet'}</Btn>
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Your editor can talk to Mushi Mushi' : `Agent access live on ${projectLabel}`}
      subtitle={label}
      action={
        onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('catalog')}>{actions.catalog ?? 'View catalog'}</Btn>
        ) : null
      }
    />
  )
}
