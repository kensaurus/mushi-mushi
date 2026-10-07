/**
 * FILE: apps/admin/src/lib/uxRuns.ts
 * PURPOSE: Types and status vocabulary for the UX runs page (Plan 021):
 *          runs synced from `mushi ux run --sync`.
 */

import type { CHIP_TONE } from './chipTone'

export type UxSurfaceStatus =
  | 'pending'
  | 'baseline'
  | 'iterating'
  | 'accepted'
  | 'reverted'
  | 'skipped'
  | 'regressed'
  | 'blocked'

export interface UxRunListItem {
  id: string
  local_run_id: string
  mode: 'local' | 'cloud'
  status: 'running' | 'done' | 'failed' | 'stopped'
  agent: string
  model: string | null
  judge_model: string | null
  branch: string | null
  counts: Partial<Record<UxSurfaceStatus, number>>
  started_at: string
  finished_at: string | null
  updated_at: string
  /** Live progress (absent on runs synced before it existed). */
  phase?: UxRunPhase | null
  phase_detail?: string | null
  current_surface?: string | null
  current_attempt?: number | null
  /** What the agent is doing now; refreshed every 30 s while an attempt runs. */
  current_progress?: UxRunLiveStep | null
  skill?: string | null
  base_ref?: string | null
  error?: string | null
}

interface UxRunLiveStep {
  steps: number
  last_step: string | null
  files: string[]
  started_at: string
  timeout_ms: number | null
}

/** A running mushi-ux checks in every 30 s; past this, say the run may have stopped. */
const UX_QUIET_AFTER_MS = 3 * 60_000

/** Whole minutes since a running run last checked in, or 0 while it is fresh (or not running). */
export function uxRunQuietMinutes(run: Pick<UxRunListItem, 'status' | 'updated_at'>, now: number): number {
  if (run.status !== 'running') return 0
  const gap = now - Date.parse(run.updated_at)
  return Number.isFinite(gap) && gap > UX_QUIET_AFTER_MS ? Math.floor(gap / 60_000) : 0
}

/** "4m 05s" / "45s". */
export function uxDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export type UxRunPhase = 'starting' | 'worktree' | 'install' | 'dev-server' | 'mapping' | 'working' | 'reviewing' | 'done' | 'failed'

export const UX_PHASE_LABEL: Record<UxRunPhase, string> = {
  starting: 'Starting',
  worktree: 'Creating worktree',
  install: 'Installing',
  'dev-server': 'Starting dev server',
  mapping: 'Mapping screens',
  working: 'Working',
  reviewing: 'Reviewing',
  done: 'Done',
  failed: 'Failed',
}

/** Screenshot slot keys: before-desktop, after-mobile, diff-desktop, … */
export type UxViewport = 'desktop' | 'mobile'

export interface UxProbe {
  axe: Array<{ id: string; impact: string | null; help: string; count: number }>
  overflowX: boolean
  smallTargets: number
  consoleErrors: number
  cls: number
}

export interface UxJudge {
  viewport: string
  model: string
  preferred: 'before' | 'after' | 'tie'
  confidence: 'low' | 'medium' | 'high'
  summary: string
  better?: Array<{ what: string; why: string }>
  worse?: Array<{ what: string; why: string }>
  error?: string
}

export interface UxSurfaceRow {
  id: string
  surface_key: string
  kind: 'page' | 'tab' | 'dialog' | 'menu'
  path: string
  label: string
  status: UxSurfaceStatus
  note: string | null
  penalty_before: number | null
  penalty_after: number | null
  probe_before: UxProbe | null
  probe_after: UxProbe | null
  judge: UxJudge[] | null
  report_id: string | null
  thumb_before_url: string | null
  thumb_after_url: string | null
  thumb_diff_url: string | null
  /** Signed URLs by slot (before-mobile, after-desktop, …). */
  thumb_urls?: Record<string, string>
  /** Small-steps mode: the screen's plan as a checklist (absent on runs without it). */
  plan?: UxPlanStep[] | null
}

export interface UxPlanStep {
  text: string
  status: 'pending' | 'done' | 'skipped' | 'failed'
  attempt?: number | null
}

export const UX_PLAN_STEP_META: Record<UxPlanStep['status'], { mark: string; label: string }> = {
  done: { mark: '✓', label: 'kept' },
  failed: { mark: '✗', label: 'rolled back' },
  skipped: { mark: '–', label: 'not needed' },
  pending: { mark: '○', label: 'to do' },
}

export const UX_RUN_STATUS_LABEL: Record<UxRunListItem['status'], string> = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
}

/** Kept edits in a run: one per kept attempt, so a screen improved in 3 steps counts 3. */
export function uxKeptEdits(iterations: ReadonlyArray<Pick<UxIterationRow, 'outcome'>>): number {
  return iterations.filter((i) => i.outcome === 'accepted').length
}

/**
 * Pure: an attempt's synced steps for reading, consecutive repeats folded
 * ("[find] a search" ×4 becomes one "[find] 4 searches" line).
 */
export function foldSteps(steps: string): string[] {
  const out: Array<{ line: string; n: number }> = []
  for (const line of steps.split('\n').filter(Boolean)) {
    const last = out[out.length - 1]
    if (last && last.line === line) last.n++
    else out.push({ line, n: 1 })
  }
  return out.map(({ line, n }) => {
    if (n === 1) return line
    if (line === '[find] a search') return `[find] ${n} searches`
    if (line === '[run] a command') return `[run] ${n} commands`
    return `${line} (×${n})`
  })
}

export interface UxIterationRow {
  id: string
  surface_id: string
  n: number
  agent: string
  model: string | null
  duration_ms: number | null
  outcome: 'accepted' | 'rejected' | 'agent_failed' | 'capture_failed' | 'no_change'
  reason: string | null
  commit_sha: string | null
  pixel_diff?: Record<string, number>
  penalty_after?: number | null
  /** What the agent did, one step per line (absent on runs synced before it existed). */
  steps?: string | null
  /** Small-steps mode: the plan step this attempt made. */
  step?: string | null
  /** Signed URLs by slot (after-mobile, diff-desktop, …). */
  thumb_urls?: Record<string, string>
}

export interface UxRunDetail {
  run: UxRunListItem
  surfaces: UxSurfaceRow[]
  iterations: UxIterationRow[]
}

type Tone = keyof typeof CHIP_TONE

export const UX_STATUS_META: Record<UxSurfaceStatus, { label: string; tone: Tone; hint: string }> = {
  accepted: { label: 'Improved', tone: 'okSubtle', hint: 'An edit was kept: nothing measured got worse and the screen changed.' },
  reverted: { label: 'Rolled back', tone: 'dangerSubtle', hint: 'Every attempt made a measured problem worse, so it was undone.' },
  regressed: { label: 'Moved by another fix', tone: 'warnSubtle', hint: 'A change kept on another screen (often a shared component or token) changed this one.' },
  blocked: { label: 'Not finished', tone: 'neutral', hint: 'The screen did not render for capture (check sign-in or the read allowlist), or the agent never finished an attempt. The screen note says which.' },
  skipped: { label: 'No change needed', tone: 'neutral', hint: 'The agent made no edit, or nothing visible changed.' },
  iterating: { label: 'Agent working', tone: 'infoSubtle', hint: 'The agent is editing this screen now.' },
  baseline: { label: 'Measuring', tone: 'infoSubtle', hint: 'Taking the before screenshots and measurements.' },
  pending: { label: 'Queued', tone: 'neutral', hint: 'Waiting for its turn.' },
}

/** Order for the burndown: what needs a human first. */
export const UX_STATUS_ORDER: UxSurfaceStatus[] = [
  'regressed',
  'reverted',
  'blocked',
  'iterating',
  'baseline',
  'accepted',
  'skipped',
  'pending',
]

export function sortSurfaces(rows: readonly UxSurfaceRow[]): UxSurfaceRow[] {
  return [...rows].sort((a, b) => UX_STATUS_ORDER.indexOf(a.status) - UX_STATUS_ORDER.indexOf(b.status))
}

/** Problems still present on the current version of a screen, one line each. */
export function problemLines(p: UxProbe | null): string[] {
  if (!p) return []
  const lines = p.axe.map((v) => `${v.help} (${v.count})`)
  if (p.overflowX) lines.push('Scrolls sideways')
  if (p.smallTargets) lines.push(`${p.smallTargets} tap target(s) under 24 px`)
  if (p.consoleErrors) lines.push(`${p.consoleErrors} console error(s)`)
  if (p.cls > 0.1) lines.push(`Layout shift ${p.cls}`)
  return lines
}
