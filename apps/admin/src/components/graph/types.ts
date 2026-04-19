/**
 * FILE: apps/admin/src/components/graph/types.ts
 * PURPOSE: Shared interfaces, edge/node enums, and helper lookups used across
 *          all GraphPage subcomponents. Keeps the page itself a thin
 *          orchestration shell.
 */

export interface GraphNode {
  id: string
  node_type: string
  label: string
  metadata?: Record<string, unknown> | null
  last_traversed_at?: string | null
  created_at?: string | null
}

export interface GraphEdge {
  id: string
  source_node_id: string
  target_node_id: string
  edge_type: string
  weight: number
}

export interface BlastRadiusItem {
  target_node_id?: string
  node_id?: string
  node_type: string
  label: string
  min_depth: number
}

export const EDGE_TYPES = [
  'causes',
  'related_to',
  'regression_of',
  'duplicate_of',
  'affects',
  'fix_attempted',
  'fix_applied',
  'fix_verified',
] as const
export type EdgeType = (typeof EDGE_TYPES)[number]

export const EDGE_LABELS: Record<string, string> = {
  causes: 'causes',
  related_to: 'related',
  regression_of: 'regression',
  duplicate_of: 'duplicate',
  affects: 'affects',
  fix_attempted: 'fix attempted',
  fix_applied: 'fix applied',
  fix_verified: 'fix verified',
}

export const NODE_TYPES = ['report_group', 'component', 'page', 'version'] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const NODE_TYPE_LABELS: Record<string, string> = {
  report_group: 'Report group',
  component: 'Component',
  page: 'Page',
  version: 'Version',
}

export function nodeMetadataValue(n: GraphNode, key: string): string | number | null {
  const meta = n.metadata as Record<string, unknown> | null | undefined
  if (!meta) return null
  const v = meta[key]
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number') return v
  return null
}
