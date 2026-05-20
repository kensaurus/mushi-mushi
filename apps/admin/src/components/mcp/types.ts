/**
 * FILE: apps/admin/src/components/mcp/types.ts
 * PURPOSE: Shared types for the MCP admin page.
 */

export type McpTabId = 'overview' | 'setup' | 'catalog' | 'examples'
export type CatalogTabId = 'tools' | 'resources' | 'prompts'

export type McpTopPriority =
  | 'no_project'
  | 'endpoint_mismatch'
  | 'report_only_keys'
  | 'no_mcp_key'
  | 'never_connected'
  | 'healthy'

export interface McpStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  activeKeyCount: number
  mcpReadKeyCount: number
  mcpWriteKeyCount: number
  connectedKeyCount: number
  neverConnectedCount: number
  reportOnlyKeyCount: number
  lastSeenAt: string | null
  daysSinceLastSeen: number | null
  lastSeenEndpointHost: string | null
  expectedEndpointHost: string | null
  endpointMismatch: boolean
  toolCount: number
  resourceCount: number
  promptCount: number
  topPriority: McpTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_MCP_STATS: McpStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  activeKeyCount: 0,
  mcpReadKeyCount: 0,
  mcpWriteKeyCount: 0,
  connectedKeyCount: 0,
  neverConnectedCount: 0,
  reportOnlyKeyCount: 0,
  lastSeenAt: null,
  daysSinceLastSeen: null,
  lastSeenEndpointHost: null,
  expectedEndpointHost: null,
  endpointMismatch: false,
  toolCount: 22,
  resourceCount: 3,
  promptCount: 3,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}

export interface McpKeyRow {
  id: string
  key_prefix: string
  created_at: string
  is_active: boolean
  revoked: boolean
  scopes?: string[]
  label?: string | null
  last_seen_at?: string | null
  last_seen_endpoint_host?: string | null
}

export interface McpProjectRow {
  id: string
  name: string
  api_keys: McpKeyRow[]
}

export interface McpProjectsResponse {
  projects: McpProjectRow[]
  admin_host?: string | null
}
