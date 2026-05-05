/**
 * FILE: apps/admin/src/components/graph/types.ts
 * PURPOSE: Shared interfaces, edge/node enums, and helper lookups used across
 *          all GraphPage subcomponents. Keeps the page itself a thin
 *          orchestration shell.
 *
 * v2 (2026-05): positive inventory node types + bidirectional edges
 * (reports_against, errors_on, …) from the whitepaper §3 graph model.
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
  // v2 bidirectional inventory edges (subset surfaced in filters)
  'contains',
  'triggers',
  'calls',
  'writes',
  'reads',
  'verified_by',
  'implements',
  'reports_against',
  'errors_on',
  'similar_to',
  'fixed_by',
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
  contains: 'contains',
  triggers: 'triggers',
  calls: 'calls',
  writes: 'writes',
  reads: 'reads',
  verified_by: 'verified by',
  implements: 'implements',
  reports_against: 'report →',
  errors_on: 'error →',
  similar_to: 'similar',
  fixed_by: 'fixed by',
}

export const NODE_TYPES = [
  'report_group',
  'component',
  'page',
  'version',
  'app',
  'page_v2',
  'element',
  'action',
  'api_dep',
  'db_dep',
  'test',
  'user_story',
] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const NODE_TYPE_LABELS: Record<string, string> = {
  report_group: 'Report group',
  component: 'Component',
  page: 'Page',
  version: 'Version',
  app: 'App',
  page_v2: 'Page (inventory)',
  element: 'Element',
  action: 'Action',
  api_dep: 'API',
  db_dep: 'Database',
  test: 'Test',
  user_story: 'User story',
}

/** Default filters for GraphPage "Surface" view — positive graph + reports. */
export const SURFACE_DEFAULT_NODE_TYPES: NodeType[] = [
  'user_story',
  'page_v2',
  'element',
  'action',
  'api_dep',
  'db_dep',
  'test',
  'app',
  'report_group',
]

export const SURFACE_DEFAULT_EDGE_TYPES: EdgeType[] = [
  'contains',
  'triggers',
  'calls',
  'writes',
  'reads',
  'verified_by',
  'implements',
  'reports_against',
  'errors_on',
  'fix_verified',
]

export function nodeMetadataValue(n: GraphNode, key: string): string | number | null {
  const meta = n.metadata as Record<string, unknown> | null | undefined
  if (!meta) return null
  const v = meta[key]
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number') return v
  return null
}
