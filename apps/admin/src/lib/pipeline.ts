/**
 * FILE: apps/admin/src/lib/pipeline.ts
 * PURPOSE: The bug-to-merge pipeline view (/pipeline): its read model and its
 *          one-click actions. The server decides stages and stuck groups
 *          (_shared/pipeline-view.ts); this file names the actions, says what
 *          each one changes before it runs, and calls its route:
 *
 *            re_review, rerun_ci, queue_merge → the existing fix and merge-queue routes
 *            dismiss                          → the report's own close route (PATCH /v1/admin/reports/:id)
 *            everything else                  → POST /v1/admin/pipeline/actions
 *                                               (requeue sends local worker run ids as claimIds)
 *
 *          deployIntakeWarning is the 14-day silence on the Intake line
 *          (report 9f64a77b): why reporters are not told, and the
 *          deploy.completed event that records a deploy.
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
  | 'followup'
  | 'dismiss'
  | 'requeue'

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
  /**
   * The group's actions the server already knows it would refuse for this
   * item, each with the reason it would give (report 69fcafcb). Shown
   * disabled with that reason. Absent on an older server: every action offered.
   */
  blocked?: Partial<Record<PipelineAction, string>>
}

export interface PipelineGroup {
  id: string
  stage: PipelineStageId
  tone: GroupTone
  label: string
  count: number
  oldestAt: string | null
  actions: PipelineAction[]
  /** The setting that holds the group; `hint` says what it needs. */
  settings: { label: string; to: string; hint?: string } | null
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
  local: {
    runs24h: number
    running: number
    lastAt: string | null
    /** Registered local worker lanes (ADR 0048), those taking new reports, and their models. */
    lanes?: number
    lanesActive?: number
    models?: string[]
  }
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
    confirm: 'Sends each PR to an agent that makes its CI green without weakening tests: Mushi’s cloud agent when review follow-ups can run, otherwise your local mushi work lanes on their next mushi work --followups run.',
    needsConfirm: true,
    needsReason: false,
    variant: 'success',
  },
  followup: {
    label: 'Send to follow-up',
    confirm: 'Sends each PR’s Opus findings to an agent that fixes them on the same branch: Mushi’s cloud agent when review follow-ups can run, otherwise your local mushi work lanes on their next mushi work --followups run.',
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
  dismiss: {
    label: 'Not a code bug',
    confirm: 'Closes each report with the reason below and tells its reporter. Nothing runs on it again unless someone reopens it.',
    needsConfirm: true,
    needsReason: false,
    variant: 'ghost',
  },
  requeue: {
    label: 'Requeue',
    confirm: 'Puts each report back at the front of the local worker lane that ran it. The machine stopped it, not the code, so it never counts against the report.',
    needsConfirm: true,
    needsReason: false,
    variant: 'success',
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
      // Requeue items are local worker runs, not fixes.
      body: JSON.stringify(action === 'requeue' ? { action, claimIds: chunk } : { action, fixIds: chunk, reason }),
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

/** "Not a code bug": close each item's report through the report route (the reporter is told). */
async function dismissReports(fixIds: string[], reportIds: Array<string | null>, reason?: string): Promise<ActionOutcome[]> {
  const out: ActionOutcome[] = []
  for (let i = 0; i < fixIds.length; i++) {
    const reportId = reportIds[i]
    if (!reportId) {
      out.push({ id: fixIds[i], ok: false, message: 'No report to close.' })
      continue
    }
    const res = await apiFetch<unknown>(`/v1/admin/reports/${encodeURIComponent(reportId)}`, {
      method: 'PATCH',
      scope: 'enumeration',
      body: JSON.stringify({ status: 'dismissed', ...(reason ? { closed_reason: reason } : {}) }),
    })
    out.push(res.ok ? { id: fixIds[i], ok: true, message: 'Report closed; its reporter is told.' } : { id: fixIds[i], ok: false, message: res.error?.message ?? 'The report was not closed.' })
  }
  return out
}

/**
 * The ids an action may run on: items whose action the server does not
 * already refuse. A bulk button runs on these only and says how many.
 */
export function actionableIds(items: readonly Pick<PipelineItem, 'id' | 'prUrl' | 'reportId' | 'blocked'>[], action: PipelineAction): string[] {
  return items.filter((i) => (action === 'dismiss' || action === 'requeue' ? !!i.reportId : !!i.prUrl) && !i.blocked?.[action]).map((i) => i.id)
}

/** The one reason every item gives for an action, or null when they differ or some can run. */
export function sharedBlockReason(items: readonly Pick<PipelineItem, 'blocked'>[], action: PipelineAction): string | null {
  const reasons = new Set(items.map((i) => i.blocked?.[action] ?? ''))
  if (reasons.size !== 1) return null
  const [only] = reasons
  return only || null
}

/** Run one action on these fixes; every item gets its own result. `reportIds` lines up with `fixIds` (dismiss). */
export async function runPipelineAction(action: PipelineAction, fixIds: string[], reason?: string, reportIds: Array<string | null> = []): Promise<ActionOutcome[]> {
  if (fixIds.length === 0) return []
  if (action === 'dismiss') return dismissReports(fixIds, reportIds, reason)
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

/** Same 14-day silence as setup-gaps `deployGap` (report 9f64a77b). */
export const DEPLOY_SILENCE_MS = 14 * 24 * 3600_000

/**
 * The CI event that records a deploy. Kept in step with
 * `DEPLOY_EVENT_SETTING.hint` in `_shared/pipeline-view.ts`.
 */
export const DEPLOY_EVENT_HOWTO =
  'Send one from CI with an agent key (mcp:write): POST /v1/ingest/recipe/events {"events":[{"type":"deploy.completed","targetId":"web","ok":true,"commit":"<sha>"}]}.'

/**
 * Warning for the Intake and deploys line. null when a deploy was seen inside
 * 14 days. `last` null means nothing in that window.
 */
export function deployIntakeWarning(last: { at: string } | null, now: number): string | null {
  if (!last) return `no deploy recorded in 14 days, so reporters are not told their fix is live. ${DEPLOY_EVENT_HOWTO}`
  const t = Date.parse(last.at)
  if (!Number.isFinite(t)) return null
  const days = Math.floor((now - t) / (24 * 3600_000))
  if (days < 14) return null
  return `Too old (${days} days): reporters are not told their fix is live. ${DEPLOY_EVENT_HOWTO}`
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

/** One fix's place in the pipeline (GET /v1/admin/pipeline/fix/:id): its group, the group's actions and what the server would refuse. */
export interface PipelineFixView {
  generatedAt: string
  stage: PipelineStageId | null
  groupId: string | null
  groupLabel: string | null
  tone: GroupTone | null
  actions: PipelineAction[]
  item: PipelineItem | null
}

export async function loadPipelineFix(fixId: string): Promise<PipelineFixView | null> {
  const res = await apiFetch<PipelineFixView>(`/v1/admin/pipeline/fix/${encodeURIComponent(fixId)}`, { scope: 'enumeration' })
  return res.ok && res.data ? res.data : null
}
