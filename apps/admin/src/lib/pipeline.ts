/**
 * FILE: apps/admin/src/lib/pipeline.ts
 * PURPOSE: The bug-to-merge pipeline view (/pipeline): its read model and its
 *          one-click actions. The server decides stages and stuck groups
 *          (_shared/pipeline-view.ts); this file names the actions, says what
 *          each one changes before it runs, and calls its route:
 *
 *            re_review, rerun_ci, queue_merge → the existing fix and merge-queue routes
 *            everything else                  → POST /v1/admin/pipeline/actions
 */

import { apiFetch } from './supabase'

type PipelineStageId = 'reported' | 'triaged' | 'pr' | 'review' | 'ci' | 'train' | 'merged' | 'deployed'
type GroupTone = 'stuck' | 'moving' | 'done'
export type PipelineAction =
  | 're_review'
  | 'rerun_ci'
  | 'ci_repair'
  | 'update_branch'
  | 'conflict_agent'
  | 'mark_ready'
  | 'queue_merge'
  | 'remove'
  | 'close'

export interface PipelineItem {
  id: string
  projectId: string
  reportId: string | null
  title: string
  repo: string | null
  prNumber: number | null
  prUrl: string | null
  queueId: string | null
  since: string
  lastError: string | null
  lastEventAt: string | null
  lastEventLabel: string | null
  failingChecks: string[]
  review: { verdict: string | null; summary: string | null; findings: string[] } | null
  queueDetail: string | null
}

export interface PipelineGroup {
  id: string
  stage: PipelineStageId
  tone: GroupTone
  label: string
  count: number
  oldestAt: string | null
  actions: PipelineAction[]
  settings: { label: string; to: string } | null
  items: PipelineItem[]
}

export interface PipelineStage {
  id: PipelineStageId
  label: string
  count: number
  stuck: number
  oldestAt: string | null
  groups: PipelineGroup[]
}

export interface TrainSummary {
  repo: string
  projectId: string
  merged: number
  failed: number
  active: number
  topFailures: Array<{ check: string; count: number }>
  trains: Array<{ id: string; state: string; prNumber: number | null; members: number; attempt: number; detail: string | null; createdAt: string }>
}

/** Who opens fixes for one app: the server's dispatcher and local `mushi work` lanes. */
export interface DispatcherStatus {
  projectId: string
  name: string
  autofixOn: boolean
  opener: 'server' | 'local' | 'both' | 'nobody'
  server: { agentKeys: number; offKeys: number; dispatches24h: number; dispatches48h: number; lastAt: string | null }
  local: { runs24h: number; running: number; lastAt: string | null }
  problem: string | null
}

/** "server 0 · local 6 · nobody 2": apps by who opened a fix in the last 24 h. */
export function openerSummary(dispatchers: DispatcherStatus[]): { server: number; local: number; nobody: number } {
  let server = 0
  let local = 0
  let nobody = 0
  for (const d of dispatchers) {
    const s = d.server.dispatches24h > 0
    const l = d.local.runs24h > 0
    if (s) server++
    if (l) local++
    if (!s && !l) nobody++
  }
  return { server, local, nobody }
}

export interface PipelineData {
  generatedAt: string
  projects: Array<{ id: string; name: string; lastDeploy: { at: string; version: string | null; ok: boolean } | null }>
  stages: PipelineStage[]
  /** null: the dispatcher reads failed. */
  dispatchers: DispatcherStatus[] | null
  trains: TrainSummary[]
  /** Reports the API refused in the last 7 days, per app. null: nothing counted yet ("not recorded"). */
  intake: {
    /** The window's first day: 7 days ago, or the day counting began. */
    since: string
    apps: Array<{ projectId: string; rejected: number; byReason: Array<{ reason: string; count: number }>; sdkPackages: string[]; lastAt: string | null }>
  } | null
  ciReadable: boolean
}

const ACTIONS_PATH = '/v1/admin/pipeline/actions'

interface ActionMeta {
  label: string
  /** What it changes, said before it runs. */
  confirm: string
  /** Changes something on GitHub or in the queue: ask first. */
  needsConfirm: boolean
  /** A reason is kept as a team note on the report. */
  needsReason: boolean
  variant: 'primary' | 'ghost' | 'danger' | 'success'
}

export const ACTION_META: Record<PipelineAction, ActionMeta> = {
  ci_repair: {
    label: 'Send to CI repair',
    confirm: 'Queues one Cursor agent per PR to make its CI green without weakening tests. It counts against the review follow-up limits.',
    needsConfirm: true,
    needsReason: false,
    variant: 'success',
  },
  rerun_ci: {
    label: 'Re-run CI',
    confirm: 'Re-runs the failed CI jobs on each PR’s latest commit on GitHub.',
    needsConfirm: true,
    needsReason: false,
    variant: 'ghost',
  },
  re_review: {
    label: 'Re-run review',
    confirm: 'Asks Opus to review each PR again on its latest commit. A new verdict replaces the old one.',
    needsConfirm: true,
    needsReason: false,
    variant: 'ghost',
  },
  update_branch: {
    label: 'Update branch',
    confirm: 'GitHub merges the base branch into each PR, which starts a new CI run.',
    needsConfirm: true,
    needsReason: false,
    variant: 'ghost',
  },
  conflict_agent: {
    label: 'New conflict agent',
    confirm: 'Hands each PR back to the merge queue, which starts a conflict agent if it still conflicts (at most 2 per PR).',
    needsConfirm: true,
    needsReason: false,
    variant: 'ghost',
  },
  mark_ready: {
    label: 'Mark ready',
    confirm: 'Takes each draft out of draft on GitHub, so its CI runs.',
    needsConfirm: true,
    needsReason: false,
    variant: 'success',
  },
  queue_merge: {
    label: 'Queue to merge',
    confirm: 'Puts each PR in the merge queue. It merges when its review and CI allow it.',
    needsConfirm: true,
    needsReason: false,
    variant: 'primary',
  },
  remove: {
    label: 'Remove from queue',
    confirm: 'Takes each PR out of the merge queue. The PR stays open.',
    needsConfirm: true,
    needsReason: true,
    variant: 'ghost',
  },
  close: {
    label: 'Close PR',
    confirm: 'Closes each pull request on GitHub without merging and takes it out of the queue.',
    needsConfirm: true,
    needsReason: true,
    variant: 'danger',
  },
}

export interface ActionOutcome {
  id: string
  ok: boolean
  message: string
  url?: string | null
}

const CHUNK = 10

async function viaPipelineRoute(action: PipelineAction, ids: string[], reason?: string): Promise<ActionOutcome[]> {
  const out: ActionOutcome[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const res = await apiFetch<{ results: ActionOutcome[] }>(ACTIONS_PATH, {
      method: 'POST',
      scope: 'enumeration',
      body: JSON.stringify({ action, fixIds: chunk, reason }),
    })
    if (!res.ok || !res.data) {
      const message = res.error?.message ?? 'The request failed.'
      out.push(...chunk.map((id) => ({ id, ok: false, message })))
    } else out.push(...res.data.results)
  }
  return out
}

/** Re-review or CI re-run, one fix at a time, through their existing routes. */
async function perFix(ids: string[], kind: 're_review' | 'rerun_ci'): Promise<ActionOutcome[]> {
  const out: ActionOutcome[] = []
  for (const id of ids) {
    const res =
      kind === 're_review'
        ? await apiFetch<unknown>(`/v1/admin/fixes/${encodeURIComponent(id)}/review`, { method: 'POST', scope: 'enumeration' })
        : await apiFetch<unknown>(`/v1/admin/fixes/${encodeURIComponent(id)}/ci/rerun`, { method: 'POST', scope: 'enumeration' })
    const done = kind === 're_review' ? 'Review queued; Opus answers within about 10 minutes.' : 'Failed jobs re-run on GitHub.'
    out.push(res.ok ? { id, ok: true, message: done } : { id, ok: false, message: res.error?.message ?? 'The request failed.' })
  }
  return out
}

/** Run one action on these fixes; every item gets its own result. */
export async function runPipelineAction(action: PipelineAction, fixIds: string[], reason?: string): Promise<ActionOutcome[]> {
  if (fixIds.length === 0) return []
  if (action === 're_review' || action === 'rerun_ci') return perFix(fixIds, action)
  if (action === 'queue_merge') {
    const res = await apiFetch<{ queued: number; skipped: Array<{ fixId: string; reason: string }> }>('/v1/admin/merge-queue', {
      method: 'POST',
      scope: 'enumeration',
      body: JSON.stringify({ fixIds }),
    })
    if (!res.ok || !res.data) return fixIds.map((id) => ({ id, ok: false, message: res.error?.message ?? 'The request failed.' }))
    const skipped = new Map(res.data.skipped.map((s) => [s.fixId, s.reason]))
    return fixIds.map((id) => (skipped.has(id) ? { id, ok: false, message: skipped.get(id)! } : { id, ok: true, message: 'Queued to merge.' }))
  }
  return viaPipelineRoute(action, fixIds, reason)
}

/** "Run the merge queue now" for one app: per repo, whether a train left and, if not, why. */
export async function retryTrains(projectId: string): Promise<ActionOutcome[]> {
  const res = await apiFetch<{ results: ActionOutcome[] }>(ACTIONS_PATH, {
    method: 'POST',
    scope: 'enumeration',
    body: JSON.stringify({ action: 'train_retry', projectId }),
  })
  if (!res.ok || !res.data) return [{ id: projectId, ok: false, message: res.error?.message ?? 'The request failed.' }]
  return res.data.results
}

/** "3 done · 1 not: Both conflict agents were used…" */
export function outcomeSummary(results: ActionOutcome[]): string {
  const ok = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) return results.length === 1 ? results[0].message : `${ok} done.`
  const first = failed[0].message
  if (ok === 0 && failed.length === 1) return first
  return `${ok} done · ${failed.length} not: ${first}`
}

/** "3 h", "2 d": how long an item has been in its stage. */
export function ageLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return ''
  const ms = Math.max(0, now - Date.parse(iso))
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} d`
}

export const TRAIN_STATE_TONE: Record<string, 'ok' | 'danger' | 'accent' | 'neutral'> = {
  merged: 'ok',
  failed: 'danger',
  building: 'accent',
  testing: 'accent',
  abandoned: 'neutral',
}
