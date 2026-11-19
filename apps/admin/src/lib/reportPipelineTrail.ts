/**
 * FILE: apps/admin/src/lib/reportPipelineTrail.ts
 * PURPOSE: The report page's Pipeline strip: one report's trip through
 *          Reported → Quick check → Diagnosis → Fix → PR → CI → Merged → Live,
 *          read from GET /v1/admin/reports/:id/pipeline (the server builds it
 *          in _shared/report-pipeline-trail.ts; the states are the console's
 *          RunStatus words, so StatusMark draws them as they come).
 *
 *          Pure helpers the strip and its tests share: duration words, bar
 *          widths, the one stage to call out, and what its retry button does.
 */

import { apiFetch } from './supabase'
import type { RunStatus } from '../components/signal/StatusMark'

export type TrailStageId = 'received' | 'triage' | 'diagnosis' | 'fix' | 'pr' | 'ci' | 'merge' | 'deploy'
export type TrailRetryKind = 'triage' | 'dispatch' | 'ci_repair'

export interface TrailStage {
  id: TrailStageId
  label: string
  state: RunStatus
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  problem: string | null
  detail: string | null
  attempts: { used: number; max: number } | null
  retry: { kind: TrailRetryKind; allowed: boolean; reason: string | null } | null
}

export interface TrailJob {
  id: string
  stage: string
  status: string
  attempts: number
  maxAttempts: number
  lastError: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface ReportTrail {
  reportId: string
  fixId: string | null
  generatedAt: string
  stages: TrailStage[]
  current: TrailStageId | null
  failing: TrailStageId | null
  jobs: TrailJob[]
}

export const reportTrailPath = (reportId: string) => `/v1/admin/reports/${reportId}/pipeline`

/** "0.9 s", "42 s", "4 min", "2 h 5 min", "3 d". */
export function durationWords(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
  return `${Math.round(h / 24)} d`
}

/**
 * Each stage's bar width (0–100) against the longest stage. Square-root scale,
 * so a 2-second check and a 3-hour CI run are both visible; a stage with no
 * duration gets 0 (the strip draws an empty track). A measured stage never
 * drops under 6 %, or it would read as "no data".
 */
export function durationBarWidths(stages: readonly Pick<TrailStage, 'durationMs'>[]): number[] {
  const max = Math.max(0, ...stages.map((s) => s.durationMs ?? 0))
  if (max <= 0) return stages.map(() => 0)
  return stages.map((s) => (s.durationMs == null || s.durationMs < 0 ? 0 : Math.max(6, Math.round(Math.sqrt(s.durationMs / max) * 100))))
}

/** The one stage the strip calls out: the first failed one, else the first slow one, else none. */
export function calloutStage(trail: Pick<ReportTrail, 'stages'>): TrailStage | null {
  return trail.stages.find((s) => s.state === 'failed') ?? trail.stages.find((s) => s.state === 'slow' && s.problem) ?? null
}

/** The strip's one-word verdict beside its title. */
export function trailVerdict(trail: Pick<ReportTrail, 'stages' | 'current'>): { status: RunStatus; label: string } {
  const out = calloutStage(trail)
  if (out) return { status: out.state, label: `${out.state === 'failed' ? 'Failed at' : 'Stuck at'} ${out.label}` }
  const cur = trail.stages.find((s) => s.id === trail.current)
  if (!cur) return { status: 'passed', label: 'Live' }
  if (cur.state === 'running') return { status: 'running', label: `${cur.label} running` }
  if (cur.state === 'cancelled') return { status: 'cancelled', label: `${cur.label} closed` }
  // A stage that has not started yet: the work is waiting on the last one that did.
  return { status: cur.state === 'idle' ? 'idle' : 'waiting', label: cur.state === 'idle' ? `Next: ${cur.label}` : `Waiting: ${cur.label}` }
}

/** True while the trail is moving at triage/diagnosis, so the strip polls. */
export function trailIsTriaging(trail: Pick<ReportTrail, 'stages'> | null | undefined): boolean {
  if (!trail) return false
  return trail.stages.some((s) => (s.id === 'triage' || s.id === 'diagnosis') && (s.state === 'running' || s.state === 'waiting'))
}

export type RetryButton =
  | { kind: 'triage'; label: string; enabled: boolean; why: string | null }
  | { kind: 'dispatch'; label: string; enabled: boolean; why: string | null }
  | { kind: 'jump'; label: string; to: string }

/**
 * What the callout's button does. Triage runs here (POST …/pipeline/retry);
 * a failed fix uses the page's own dispatch (with its gate); red CI points at
 * the fix actions bar at the top of the page, which already holds CI repair
 * with the server's reasons (no second copy of that button).
 */
export function retryButtonFor(
  stage: TrailStage,
  ctx: { dispatchBlocked: boolean; dispatchReason: string | null; hasFixActions: boolean },
): RetryButton | null {
  const r = stage.retry
  if (!r) return null
  if (r.kind === 'triage') {
    return { kind: 'triage', label: stage.id === 'diagnosis' ? 'Re-run diagnosis' : 'Retry triage', enabled: r.allowed, why: r.allowed ? null : r.reason }
  }
  if (r.kind === 'dispatch') {
    return { kind: 'dispatch', label: 'Retry fix', enabled: !ctx.dispatchBlocked, why: ctx.dispatchBlocked ? ctx.dispatchReason : null }
  }
  return ctx.hasFixActions ? { kind: 'jump', label: 'CI repair ↑', to: '#report-fix-actions' } : null
}

export interface TriageRetryResult {
  ok: boolean
  outcome: 'queued' | 'already' | null
  message: string
}

export async function retryReportTriage(reportId: string, stage: 'triage' | 'diagnosis'): Promise<TriageRetryResult> {
  const res = await apiFetch<{ outcome: 'queued' | 'already'; message: string }>(`${reportTrailPath(reportId)}/retry`, {
    method: 'POST',
    body: JSON.stringify({ stage }),
  })
  if (!res.ok || !res.data) {
    return { ok: false, outcome: null, message: res.error?.message ?? 'The retry did not start. Try again in a moment.' }
  }
  return { ok: true, outcome: res.data.outcome, message: res.data.message }
}
