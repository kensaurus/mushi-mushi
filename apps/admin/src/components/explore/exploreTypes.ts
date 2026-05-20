/**
 * FILE: apps/admin/src/components/explore/exploreTypes.ts
 * PURPOSE: Shared types for the /explore codebase-atlas page.
 *          Kept separate from the report-causality graph types in
 *          components/graph/types.ts — these are read-only structural nodes
 *          (files, symbols) rather than mutable quality-signal nodes.
 */

export type ExploreLayer = 'ui' | 'lib' | 'backend' | 'test' | 'config' | 'other'

export interface ExploreNodeMeta {
  file_path: string
  symbol_name: string | null
  signature: string | null
  line_start: number | null
  line_end: number | null
  language: string | null
  layer: ExploreLayer
  content_preview: string | null
  last_modified: string | null
}

/** Node as returned by GET /v1/admin/projects/:id/codebase/explore */
export interface ExploreNode {
  id: string
  node_type: 'code_file' | 'code_symbol'
  label: string
  metadata: ExploreNodeMeta
}

/** Import edge as returned by the explore endpoint */
export interface ExploreEdge {
  id: string
  source_node_id: string
  target_node_id: string
  edge_type: 'imports'
  weight: number
}

export interface ExplorePayload {
  nodes: ExploreNode[]
  edges: ExploreEdge[]
  /** Map of layer → file count */
  layers: Record<string, number>
  total_files: number
}

/** A single semantic search hit */
export interface ExploreSearchHit {
  id: string
  file_path: string
  symbol_name: string | null
  signature: string | null
  line_start: number | null
  line_end: number | null
  content_preview: string | null
  layer: ExploreLayer
  similarity: number
}
