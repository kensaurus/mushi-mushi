/**
 * FILE: connect/clientEmoji.ts
 * PURPOSE: Default emoji glyphs for MCP client chips on public Connect surfaces.
 */

import type { McpClientId } from '@mushi-mushi/mcp/clients'

const CLIENT_EMOJI: Record<McpClientId, string> = {
  cursor: '⚡',
  vscode: '🔵',
  'vscode-insiders': '🔷',
  windsurf: '🌊',
  cline: '💻',
  'claude-code': '🔶',
  'claude-desktop': '🔸',
  zed: '⚡',
  any: '🌐',
}

export function getConnectClientEmoji(id: McpClientId): string {
  return CLIENT_EMOJI[id] ?? '🔧'
}
