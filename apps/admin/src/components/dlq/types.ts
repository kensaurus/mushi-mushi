/**
 * FILE: apps/admin/src/components/dlq/types.ts
 * PURPOSE: Shared shapes and lookup tables for the DLQPage and its
 *          subcomponents. Keeps the page focused on orchestration.
 */

export interface QueueItem {
  id: string
  report_id: string
  project_id: string
  stage: string
  status: string
  attempts: number
  max_attempts: number
  last_error: string | null
  created_at: string
  completed_at: string | null
  reports?: { description: string; user_category: string; created_at: string }
}

export interface QueueSummary {
  byStatus: Record<string, number>
  byStage: Record<string, Record<string, number>>
  stages: string[]
}

export interface ThroughputDay {
  day: string
  created: number
  completed: number
  failed: number
}

export const STATUS_OPTIONS = [
  'dead_letter',
  'failed',
  'pending',
  'running',
  'completed',
] as const

export type StatusFilter = (typeof STATUS_OPTIONS)[number]
