/**
 * FILE: apps/admin/src/components/mcp/types.ts
 * PURPOSE: Shared types for the MCP admin page.
 */

export interface McpStats {
  activeKeyCount: number
  mcpReadKeyCount: number
  mcpWriteKeyCount: number
  connectedKeyCount: number
  neverConnectedCount: number
  reportOnlyKeyCount: number
  lastSeenAt: string | null
  lastSeenEndpointHost: string | null
  endpointMismatch: boolean
  toolCount: number
  resourceCount: number
  promptCount: number
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

export type McpTabId = 'setup' | 'catalog' | 'examples'
export type CatalogTabId = 'tools' | 'resources' | 'prompts'
