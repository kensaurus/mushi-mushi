/**
 * UA-compatible knowledge graph types (subset).
 * Schema aligned with Egonex-AI/Understand-Anything knowledge-graph.json v1.
 */

export type GraphKind = 'codebase' | 'knowledge'

export interface KnowledgeGraphNode {
  id: string
  type: string
  name: string
  filePath?: string
  lineRange?: [number, number]
  summary?: string
  tags?: string[]
  languageNotes?: string[]
  metadata?: Record<string, unknown>
}

export interface KnowledgeGraphEdge {
  source: string
  target: string
  type: string
  direction?: 'directed' | 'undirected'
  description?: string
  weight?: number
}

export interface KnowledgeGraphLayer {
  id: string
  name: string
  description?: string
  nodeIds: string[]
}

export interface KnowledgeGraph {
  version: string
  kind: GraphKind
  project: {
    name: string
    languages: string[]
    frameworks: string[]
    description?: string
    analyzedAt: string
    gitCommitHash?: string
  }
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  layers: KnowledgeGraphLayer[]
  tour?: unknown[]
}

export interface FileFingerprint {
  filePath: string
  contentHash: string
  exportCount: number
  importCount: number
}

export type UpdateClassification = 'SKIP' | 'PARTIAL_UPDATE' | 'FULL_UPDATE'

export interface IndexedFileRow {
  id: string
  file_path: string
  symbol_name: string | null
  signature: string | null
  line_start: number | null
  line_end: number | null
  language: string | null
  content_preview: string | null
  content_hash?: string | null
}
