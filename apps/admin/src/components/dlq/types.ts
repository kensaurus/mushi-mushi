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
  started_at?: string | null
  scheduled_at?: string | null
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

const STATUS_LABELS: Record<StatusFilter, string> = {
  dead_letter: 'Dead letter',
  failed: 'Failed',
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
}

/** Human label for a queue lane; unknown values read as words, never `snake_case`. */
export function queueStatusLabel(value: string): string {
  const known = (STATUS_LABELS as Record<string, string | undefined>)[value]
  if (known) return known
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value
}

const STAGE_LABELS: Record<string, string> = {
  stage1: 'Fast filter',
  stage2: 'Classify',
  judge: 'Judge',
  'fix-suggestion': 'Fix suggestion',
}

/** Human label for a pipeline stage; unknown values read as words, never raw ids. */
export function queueStageLabel(value: string): string {
  const known = STAGE_LABELS[value]
  if (known) return known
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value
}

/** "12 min", "5 h", "24 d": how long a job has waited, in the units the Pipeline page uses. */
export function waitedLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} d`
}

/**
 * A job's last error in words. Edge functions store
 * `Stage 1 failed: 500 {"ok":false,"error":"…"}` and every row showed that
 * JSON verbatim (console audit 2026-11-21). The message is lifted out; the
 * raw text stays available as `detail` when it differs.
 */
export function readableQueueError(raw: string): { text: string; detail: string | null } {
  const trimmed = raw.trim()
  const match = /^([\s\S]*?)\b(\d{3})\s*(\{[\s\S]*\})\s*$/.exec(trimmed)
  if (!match) return { text: trimmed, detail: null }
  let message: unknown
  try {
    const body = JSON.parse(match[3]) as { error?: unknown; message?: unknown }
    const nested = body.error && typeof body.error === 'object' ? (body.error as { message?: unknown }).message : undefined
    message = typeof body.error === 'string' ? body.error : (nested ?? body.message)
  } catch {
    return { text: trimmed, detail: null }
  }
  if (typeof message !== 'string' || !message.trim()) return { text: trimmed, detail: null }
  const prefix = match[1].trim().replace(/[:\s]+$/, '')
  return { text: prefix ? `${prefix}: ${message.trim()}` : message.trim(), detail: trimmed }
}
