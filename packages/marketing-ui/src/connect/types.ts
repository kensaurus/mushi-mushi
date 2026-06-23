/**
 * FILE: connect/types.ts
 * PURPOSE: Shared Connect surface lane + client selection types.
 */

export type ConnectLane = 'mcp' | 'cli' | 'skills'

export const CONNECT_LANE_OPTIONS: { id: ConnectLane; label: string }[] = [
  { id: 'mcp', label: 'MCP — AI agent' },
  { id: 'cli', label: 'CLI' },
  { id: 'skills', label: 'Skills' },
]
