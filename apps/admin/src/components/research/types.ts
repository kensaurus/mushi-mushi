/**
 * FILE: apps/admin/src/components/research/types.ts
 * PURPOSE: Shared shapes for the Research page and subcomponents.
 */

export interface Snippet {
  id: string
  url: string
  title: string | null
  snippet: string | null
  attached_to_report_id: string | null
}

export interface SessionRow {
  id: string
  query: string
  mode: 'search' | 'scrape'
  result_count: number
  created_at: string
}

export interface SearchResponse {
  sessionId: string
  createdAt: string
  query: string
  results: Snippet[]
}

export interface FirecrawlConfig {
  configured: boolean
  keyHint: string | null
  addedAt: string | null
  lastUsedAt: string | null
  testStatus: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null
  testedAt: string | null
  allowedDomains: string[]
  maxPagesPerCall: number
}

export const MODE_TONE: Record<SessionRow['mode'], string> = {
  search: 'bg-info-muted text-info',
  scrape: 'bg-brand/15 text-brand border border-brand/30',
}
