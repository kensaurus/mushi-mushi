/**
 * FILE: apps/admin/src/lib/timeline.ts
 * PURPOSE: Types and pure helpers for the app's iteration Timeline
 *          (Plan 025 P1/P8, ADR 0072): the rail of releases (or UX runs),
 *          each screen's pinned screenshots, and what each step cost.
 *
 * Data: GET /v1/admin/projects/:pid/timeline
 *       GET /v1/admin/projects/:pid/timeline/surfaces/:key
 */

import type { CHIP_TONE } from './chipTone'

type BadgeTone = keyof typeof CHIP_TONE

export interface TimelinePoint {
  id: string
  kind: 'release' | 'run' | 'unreleased'
  at: string
  label: string
  title: string | null
  status: string | null
  version: string | null
  runs: Array<{ id: string; local_run_id: string; kind: string; cost_usd: number | null }>
  cost_usd: number | null
  judged: number
  cached: number
  score: number | null
  improved_screens: number
  reports_closed: number
  reports: Array<{ id: string; title: string }>
  baselines: number
}

interface TimelineFrame {
  baseline_id: string
  point_id: string | null
  version: string
  viewport: string
  created_at: string
  score: number | null
  penalty: number | null
  cost_usd: number | null
  pinned: boolean
}

interface TimelineSurfaceSummary {
  key: string
  label: string
  path: string
  latest_score: number | null
  first_score: number | null
  frames: TimelineFrame[]
  thumb_url: string | null
}

interface TimelineMonth {
  since: string
  releases: number
  reports_closed: number
  top_reports: Array<{ id: string; title: string }>
  screens_improved: number
  runs: number
  cost_usd: number | null
  judged: number
  cached: number
  movers: Array<{ key: string; label: string; from: number; to: number }>
}

export interface TimelineData {
  rail: 'releases' | 'runs'
  points: TimelinePoint[]
  surfaces: TimelineSurfaceSummary[]
  month: TimelineMonth
  settings: { keep_releases: number; auto_pin?: boolean }
}

export interface SurfaceHistoryFrame {
  id: string
  surface_key: string
  path: string
  label: string
  viewport: string
  version: string
  release_id: string | null
  run_id: string | null
  score: number | null
  penalty: number | null
  cost_usd: number | null
  pinned: boolean
  created_at: string
  url: string | null
}

export interface SurfaceHistory {
  surface: { key: string; label: string; path: string | null }
  frames: SurfaceHistoryFrame[]
  scores: Array<{ at: string; run: string | null; score: number; cached: boolean; cost_usd: number | null }>
  changes: Array<{ at: string; run: string | null; shipped: boolean; what: string; commit_sha: string | null }>
}

/** "$0.42", "<$0.01", "$0" (all reused), or "–" when nothing was recorded. */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return '–'
  if (usd === 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  return usd < 10 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`
}

/** "3 scored · 9 reused" — what the model was asked versus what was reused. */
export function judgeLine(judged: number, cached: number): string | null {
  if (!judged && !cached) return null
  const parts: string[] = []
  if (judged) parts.push(`${judged} scored`)
  if (cached) parts.push(`${cached} reused`)
  return parts.join(' · ')
}

/** Share of verdicts that cost no model call, as a whole percent, or null. */
export function reuseShare(judged: number, cached: number): number | null {
  const n = judged + cached
  return n ? Math.round((cached / n) * 100) : null
}

/** The dot's tone on the rail: a release that shipped, a draft, an unreleased tail, a run. */
export function pointTone(p: Pick<TimelinePoint, 'kind' | 'status'>): BadgeTone {
  if (p.kind === 'unreleased') return 'info'
  if (p.kind === 'release') return p.status === 'published' ? 'ok' : 'neutral'
  return p.status === 'failed' ? 'danger' : 'brand'
}

/** The series the sparkline draws: one value per point that has one, oldest first. */
export function seriesOf(points: readonly TimelinePoint[], pick: 'score' | 'cost'): number[] {
  return points.map((p) => (pick === 'score' ? p.score : p.cost_usd)).filter((v): v is number => v != null && Number.isFinite(v))
}

/** "+2", "−1", or null: a screen's score change from its first to its latest pinned shot. */
export function scoreDelta(first: number | null, latest: number | null): string | null {
  if (first == null || latest == null || first === latest) return null
  const d = latest - first
  return d > 0 ? `+${d}` : `−${Math.abs(d)}`
}

/** The two frames the comparison opens on: the oldest and newest at one viewport. */
export function defaultPair<T extends { viewport: string; url: string | null }>(frames: readonly T[], viewport: string): { before: T | null; after: T | null } {
  const at = frames.filter((f) => f.viewport === viewport && f.url)
  if (!at.length) return { before: null, after: null }
  return { before: at.length > 1 ? at[0] : null, after: at[at.length - 1] }
}

/** A version label to suggest for "Pin current screens": the newest release without shots, else today. */
export function suggestVersion(points: readonly TimelinePoint[], today: Date): string {
  const open = [...points].reverse().find((p) => p.kind === 'release' && p.version && p.baselines === 0)
  return open?.version ?? today.toISOString().slice(0, 10)
}

/** Keyboard step for the comparison handle: arrows move 2 %, with Shift 10 %, Home/End to the edges. */
export function sliderStep(key: string, shift: boolean, value: number): number | null {
  const step = shift ? 10 : 2
  if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.max(0, value - step)
  if (key === 'ArrowRight' || key === 'ArrowUp') return Math.min(100, value + step)
  if (key === 'Home') return 0
  if (key === 'End') return 100
  if (key === 'PageDown') return Math.max(0, value - 25)
  if (key === 'PageUp') return Math.min(100, value + 25)
  return null
}
