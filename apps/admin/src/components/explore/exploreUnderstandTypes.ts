/**
 * Types for codebase Understand features (chat, tour, domains, impact).
 */

export interface CodebaseCitation {
  file_path: string
  line_start: number | null
  line_end: number | null
  symbol_name: string | null
  similarity?: number
}

export interface TourStop {
  order: number
  title: string
  rationale: string
  node_ids: string[]
  file_paths: string[]
  layer: string
}

export interface DomainStep {
  id: string
  name: string
  description: string
  file_paths: string[]
}

export interface DomainFlow {
  id: string
  name: string
  description: string
  steps: DomainStep[]
}

export interface DomainView {
  id: string
  name: string
  description: string
  flows: DomainFlow[]
}

export type DomainExtractionSource = 'llm' | 'fallback'

export interface CodebaseImpactResult {
  changed_paths: string[]
  affected_file_paths: string[]
  affected_node_ids: string[]
  source?: 'paths' | 'last_push' | 'compare' | 'fix'
  meta?: Record<string, string | null> | null
}

export interface CodebaseUnderstandError {
  code: 'NO_LLM_KEY' | 'INDEX_DISABLED' | 'RATE_LIMITED' | 'FORBIDDEN' | string
  message: string
}

export interface AskSeed {
  question: string
  fileFocus?: { file_path: string; symbol_name?: string | null }
}
