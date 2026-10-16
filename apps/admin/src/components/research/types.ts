/**
 * FILE: apps/admin/src/components/research/types.ts
 * PURPOSE: Shared shapes for the Research page and subcomponents.
 */

import { CHIP_TONE } from '../../lib/chipTone'

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

export const MODE_TONE: Record<SessionRow['mode'], string> = {
  search: CHIP_TONE.infoSubtle,
  scrape: 'bg-brand/12 text-brand border border-brand/28',
}
