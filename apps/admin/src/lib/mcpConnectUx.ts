/**
 * Shared MCP connect posture — keeps Connect strip, guide lanes, and nav badges aligned.
 */

import type { McpStats } from '../components/mcp/types'

export interface McpConnectUx {
  /** At least one MCP-scoped key has been used from an IDE. */
  ideConnected: boolean
  /** Minted MCP keys that have never been used in an IDE. */
  unusedKeyCount: number
  /** Connect strip / guide treat MCP setup as complete. */
  stripDone: boolean
  /** Housekeeping: IDE works but unused minted keys remain. */
  hasUnusedKeys: boolean
}

export function resolveMcpConnectUx(
  stats: Pick<McpStats, 'connectedKeyCount' | 'neverConnectedCount' | 'mcpReadKeyCount'>,
): McpConnectUx {
  const ideConnected = stats.connectedKeyCount > 0
  const unusedKeyCount = stats.neverConnectedCount
  const hasUnusedKeys = unusedKeyCount > 0 && stats.mcpReadKeyCount > 0
  return {
    ideConnected,
    unusedKeyCount,
    stripDone: ideConnected,
    hasUnusedKeys,
  }
}

export function mcpUnusedKeysBadgeLabel(count: number): string {
  return `${count} unused MCP key${count === 1 ? '' : 's'} — add to IDE or revoke`
}

export function mcpConnectStripDetail(ux: McpConnectUx): string | null {
  if (!ux.hasUnusedKeys) return null
  return `${ux.unusedKeyCount} unused MCP key${ux.unusedKeyCount === 1 ? '' : 's'}`
}
