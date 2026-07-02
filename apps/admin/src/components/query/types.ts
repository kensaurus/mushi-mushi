/**
 * FILE: apps/admin/src/components/query/types.ts
 */

export type QueryTabId = 'overview' | 'ask' | 'history' | 'schema'

export type QueryMode = 'nl' | 'raw'

export interface HistoryRow {
  id: string
  prompt: string
  sql: string | null
  summary: string | null
  explanation: string | null
  row_count: number
  error: string | null
  latency_ms: number | null
  is_saved?: boolean
  mode?: QueryMode
  created_at: string
}

export interface TeamRow extends HistoryRow {
  user_id: string | null
  author_email: string | null
  author_name: string | null
}

export interface QueryStats {
  projectId: string | null
  projectName: string | null
  planId: string
  planDisplayName: string
  savedCount: number
  recentCount: number
  teamSavedCount: number
  runs24h: number
  errors24h: number
  nlRuns24h: number
  rawRuns24h: number
  avgLatencyMs: number | null
  lastRunAt: string | null
  lastRunPrompt: string | null
  lastRunError: string | null
  schemaDegraded: boolean
}

export const EMPTY_QUERY_STATS: QueryStats = {
  projectId: null,
  projectName: null,
  planId: 'hobby',
  planDisplayName: 'Hobby',
  savedCount: 0,
  recentCount: 0,
  teamSavedCount: 0,
  runs24h: 0,
  errors24h: 0,
  nlRuns24h: 0,
  rawRuns24h: 0,
  avgLatencyMs: null,
  lastRunAt: null,
  lastRunPrompt: null,
  lastRunError: null,
  schemaDegraded: false,
}

