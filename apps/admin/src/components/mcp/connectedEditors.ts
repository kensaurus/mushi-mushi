/**
 * FILE: apps/admin/src/components/mcp/connectedEditors.ts
 * PURPOSE: The editors that actually talk to Mushi, for the top of Editor
 *          agents (console journeys 2026-10-27): every live key with an MCP
 *          scope that has called at least once, newest call first. SDK-only
 *          keys (report:write) are never an editor.
 */

import type { McpKeyRow, McpStats } from './types'

export interface ConnectedEditor {
  id: string
  name: string
  lastCallAt: string
  host: string | null
  canWrite: boolean
}

/** The server's rule (mcp-admin.ts hasMcpRead): mcp:read or mcp:write. */
function isEditorKey(k: McpKeyRow): boolean {
  const scopes = k.scopes ?? []
  return scopes.includes('mcp:read') || scopes.includes('mcp:write')
}

export function connectedEditors(keys: readonly McpKeyRow[]): ConnectedEditor[] {
  return keys
    .filter((k) => k.is_active && !k.revoked && isEditorKey(k) && k.last_seen_at)
    .map((k) => ({
      id: k.id,
      name: k.label?.trim() || `Key ${k.key_prefix}`,
      lastCallAt: k.last_seen_at as string,
      host: k.last_seen_endpoint_host ?? null,
      canWrite: (k.scopes ?? []).includes('mcp:write'),
    }))
    .sort((a, b) => b.lastCallAt.localeCompare(a.lastCallAt))
}

/** Key health in one line instead of six tiles. */
export function keyHealthLine(stats: Pick<McpStats, 'activeKeyCount' | 'mcpReadKeyCount' | 'mcpWriteKeyCount' | 'reportOnlyKeyCount' | 'neverConnectedCount'>): string {
  if (stats.activeKeyCount === 0) return 'No keys yet. Connecting an editor makes one for you.'
  const write = stats.mcpWriteKeyCount > 0 ? ` (${stats.mcpWriteKeyCount} of them can also start fixes)` : ''
  const parts = [`${stats.mcpReadKeyCount} for editors${write}`]
  if (stats.reportOnlyKeyCount > 0) parts.push(`${stats.reportOnlyKeyCount} only send bug reports from your app`)
  const unused = stats.neverConnectedCount > 0 ? ` ${stats.neverConnectedCount} ${stats.neverConnectedCount === 1 ? "hasn't" : "haven't"} been used yet.` : ''
  return `${stats.activeKeyCount} ${stats.activeKeyCount === 1 ? 'key' : 'keys'}: ${parts.join(', ')}.${unused}`
}
