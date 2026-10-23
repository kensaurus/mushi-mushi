/**
 * FILE: apps/admin/src/lib/mergeQueue.ts
 * PURPOSE: "Merge when ready" (ADR 0041) for the console: queue fixes' PRs,
 *          read the queue, take one out, and say in one line where it is.
 *
 *          The server's `merge-queue` worker updates a branch that is behind,
 *          waits for CI, merges through the review gate (an Opus "merge" on
 *          the exact commit), one PR per repo at a time, and hands a merge
 *          conflict to a Cursor agent.
 */

import { apiFetch } from './supabase'

export type MergeQueueState = 'queued' | 'waiting' | 'resolving' | 'blocked' | 'merged' | 'removed'

export interface MergeQueueRow {
  id: string
  fix_attempt_id: string
  project_id: string
  repo: string
  pr_number: number
  state: MergeQueueState
  detail: string | null
  head_sha: string | null
  queued_at: string
  updated_at: string
  merged_at: string | null
  conflict_agents: number
}

export const MERGE_QUEUE_STATE_LABEL: Record<MergeQueueState, string> = {
  queued: 'Queued',
  waiting: 'Waiting',
  resolving: 'Agent resolving',
  blocked: 'Needs you',
  merged: 'Merged',
  removed: 'Removed',
}

export const MERGE_QUEUE_STATE_TONE: Record<MergeQueueState, 'info' | 'accent' | 'warn' | 'ok' | 'neutral'> = {
  queued: 'info',
  waiting: 'info',
  resolving: 'accent',
  blocked: 'warn',
  merged: 'ok',
  removed: 'neutral',
}

export function isActiveQueueRow(row: Pick<MergeQueueRow, 'state'>): boolean {
  return row.state === 'queued' || row.state === 'waiting' || row.state === 'resolving' || row.state === 'blocked'
}

/** "4 to merge · 1 needs you · 6 merged today" (empty parts left out). */
export function mergeQueueSummary(rows: Array<Pick<MergeQueueRow, 'state'>>): string {
  const moving = rows.filter((r) => r.state === 'queued' || r.state === 'waiting' || r.state === 'resolving').length
  const blocked = rows.filter((r) => r.state === 'blocked').length
  const merged = rows.filter((r) => r.state === 'merged').length
  const parts: string[] = []
  if (moving) parts.push(`${moving} to merge`)
  if (blocked) parts.push(`${blocked} need${blocked === 1 ? 's' : ''} you`)
  if (merged) parts.push(`${merged} merged today`)
  return parts.join(' · ')
}

export function prLink(row: Pick<MergeQueueRow, 'repo' | 'pr_number'>): string {
  return `https://github.com/${row.repo}/pull/${row.pr_number}`
}

export async function queueMerges(fixIds: string[]) {
  return apiFetch<{ queued: number; skipped: Array<{ fixId: string; reason: string }> }>('/v1/admin/merge-queue', {
    method: 'POST',
    body: JSON.stringify({ fixIds }),
  })
}

export async function loadMergeQueue(projectId: string | null) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return apiFetch<{ rows: MergeQueueRow[] }>(`/v1/admin/merge-queue${qs}`, { cache: 'no-store' })
}

export async function removeFromMergeQueue(id: string) {
  return apiFetch<{ id: string; state: MergeQueueState }>(`/v1/admin/merge-queue/${id}`, { method: 'DELETE' })
}
