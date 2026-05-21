/**
 * FILE: apps/admin/src/lib/mcpModeUx.ts
 * PURPOSE: Mode-aware UX flags for the MCP page.
 */

import { useAdminMode } from './mode'
import type { McpStats, McpTabId } from '../components/mcp/types'

export interface McpUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideMcpSnapshot: boolean
}

export function useMcpUx(): McpUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideMcpSnapshot: isQuickstart,
  }
}

/** Quick mode: jump to setup when keys need attention, else catalog. */
export function resolveQuickMcpTab(stats: McpStats): McpTabId {
  if (
    stats.topPriority === 'endpoint_mismatch' ||
    stats.topPriority === 'never_connected' ||
    stats.topPriority === 'no_mcp_key' ||
    stats.topPriority === 'report_only_keys'
  ) {
    return 'setup'
  }
  if (stats.topPriority === 'healthy') return 'catalog'
  return 'overview'
}
