/**
 * FILE: apps/admin/src/lib/mergeQueue.ts
 * PURPOSE: "Merge when ready" (ADR 0041) for the console: queue fixes' PRs,
 *          read the queue, take one out, and say in one line where it is.
 *
 *          The server's `merge-queue` worker updates a branch that is behind,
 *          waits for CI, merges through the review gate (an Opus "merge" on
 *          the exact commit), one PR per repo at a time, and hands a merge
 *          conflict to a Cursor agent. With release trains (ADR 0044, the
 *          default) it batches an app's approved PRs into one train PR per
 *          interval, so they ship as one deploy and one release.
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
  blocked: 'Held',
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

/** "4 to merge · 1 held · 6 merged today" (empty parts left out). */
export function mergeQueueSummary(rows: Array<Pick<MergeQueueRow, 'state'>>): string {
  const moving = rows.filter((r) => r.state === 'queued' || r.state === 'waiting' || r.state === 'resolving').length
  const blocked = rows.filter((r) => r.state === 'blocked').length
  const merged = rows.filter((r) => r.state === 'merged').length
  const parts: string[] = []
  if (moving) parts.push(`${moving} to merge`)
  if (blocked) parts.push(`${blocked} held`)
  if (merged) parts.push(`${merged} merged today`)
  return parts.join(' · ')
}

export type ReleaseMode = 'train' | 'each'
type TrainState = 'building' | 'testing' | 'merged' | 'failed' | 'abandoned'

export interface ReleaseTrain {
  id: string
  project_id: string
  repo: string
  pr_number: number | null
  state: TrainState
  /** Member PR numbers. */
  members: number[]
  attempt: number
  detail: string | null
  created_at: string
  updated_at: string
  merged_at: string | null
}

export interface ReleaseSettings {
  projectId: string
  mode: ReleaseMode
  intervalMinutes: number
  maxMembers: number
}

export const TRAIN_INTERVAL_OPTIONS = [60, 180, 360, 720, 1440] as const

export function intervalLabel(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? 'once a day' : `every ${minutes / 1440} days`
  if (minutes % 60 === 0) return minutes === 60 ? 'every hour' : `every ${minutes / 60} hours`
  return `every ${minutes} min`
}

/**
 * One line for a repo's train: "4 fixes · CI running",
 * or when the next one leaves ("2 approved · next train leaves in 4 h"), from the last train.
 */
export function trainLine(train: Pick<ReleaseTrain, 'state' | 'members' | 'attempt' | 'detail'> | null, next?: { lastAt: string | null; intervalMinutes: number; now: Date; ready: number }): string {
  if (train && (train.state === 'building' || train.state === 'testing')) {
    const n = train.members.length
    const parts = [`${n} fix${n === 1 ? '' : 'es'}`]
    if (train.attempt > 1) parts.push(`retry ${train.attempt}`)
    parts.push(train.detail ?? (train.state === 'building' ? 'building' : 'CI running'))
    return parts.join(' · ')
  }
  if (!next || next.ready === 0) return ''
  const leavesAt = next.lastAt ? Date.parse(next.lastAt) + next.intervalMinutes * 60_000 : 0
  const mins = Math.ceil((leavesAt - next.now.getTime()) / 60_000)
  const when = mins <= 1 ? 'leaves within a few minutes' : mins < 90 ? `leaves in ${mins} min` : `leaves in ${Math.round(mins / 60)} h`
  return `${next.ready} approved · next train ${when}`
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

/**
 * What `/v1/admin/merge-queue` returns, shaped for the fixes page.
 * `seq` is taken with `nextMergeQueueFetchSeq` when the read starts.
 * The panel ignores a snapshot whose seq is older than its own last load.
 */
export interface MergeQueueSnapshot {
  /** App this read was for. The panel ignores a snapshot for another app. */
  projectId: string | null
  /** Monotonic id from when this read started, not when it landed. */
  seq: number
  rows: MergeQueueRow[]
  trains: ReleaseTrain[]
  release: ReleaseSettings | null
}

let mergeQueueFetchSeq = 0

/** Next id for a queue read. Call it when the fetch starts. */
export function nextMergeQueueFetchSeq(): number {
  mergeQueueFetchSeq += 1
  return mergeQueueFetchSeq
}

export function emptyMergeQueueSnapshot(): MergeQueueSnapshot {
  return { projectId: null, seq: 0, rows: [], trains: [], release: null }
}

/**
 * Keeps a failed or empty read as an empty queue so the page can paint once.
 * `seq` must be the id taken when the fetch started, so a slow read stays
 * older than a load the panel started after it.
 */
export function toMergeQueueSnapshot(
  data: { rows?: MergeQueueRow[]; trains?: ReleaseTrain[]; release?: ReleaseSettings[] } | null | undefined,
  projectId: string | null,
  seq: number,
): MergeQueueSnapshot {
  return {
    projectId,
    seq,
    rows: data?.rows ?? [],
    trains: data?.trains ?? [],
    release: data?.release?.find((r) => r.projectId === projectId) ?? null,
  }
}

export async function loadMergeQueue(projectId: string | null) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return apiFetch<{ rows: MergeQueueRow[]; trains?: ReleaseTrain[]; release?: ReleaseSettings[] }>(`/v1/admin/merge-queue${qs}`, { cache: 'no-store' })
}

export async function saveReleaseSettings(projectId: string, patch: Partial<Pick<ReleaseSettings, 'mode' | 'intervalMinutes' | 'maxMembers'>>) {
  return apiFetch<Record<string, unknown>>(`/v1/admin/projects/${encodeURIComponent(projectId)}/release-settings`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export async function removeFromMergeQueue(id: string) {
  return apiFetch<{ id: string; state: MergeQueueState }>(`/v1/admin/merge-queue/${id}`, { method: 'DELETE' })
}
