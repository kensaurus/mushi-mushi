/**
 * FILE: apps/admin/src/lib/uxScorecard.ts
 * PURPOSE: The UX scorecard's console side (ADR 0067): the shapes
 *          GET /v1/admin/projects/:pid/ux-scorecard returns and the small
 *          rules the view shows them with. The rubric itself lives in the
 *          server's _shared/ux-scorecard.ts.
 */

import type { CHIP_TONE } from './chipTone'

type BadgeTone = keyof typeof CHIP_TONE

export const UX_DIMENSIONS = ['clarity', 'hierarchy', 'consistency', 'states', 'truthfulness', 'copy', 'accessibility', 'performance'] as const
export type UxDimension = (typeof UX_DIMENSIONS)[number]

/** Short names for the eight rubric dimensions (the server's UX_RUBRIC labels). */
export const UX_DIMENSION_LABEL: Readonly<Record<UxDimension, string>> = {
  clarity: 'Clarity',
  hierarchy: 'Hierarchy',
  consistency: 'Consistency',
  states: 'States',
  truthfulness: 'Truthfulness',
  copy: 'Copy',
  accessibility: 'Accessibility',
  performance: 'Speed',
}

interface UxScorecardIssue {
  dimension: UxDimension
  severity: 'high' | 'medium' | 'low'
  title: string
  problem: string
  evidence: string
  fix: string
  cause: string
  confidence: number
  evidenceSeen: boolean
}

export interface UxScorecardRow {
  key: string
  label: string
  overall: number
  scores: Record<UxDimension, number>
  issues: UxScorecardIssue[]
  history: number[]
  delta: number | null
}

export interface UxScorecardCause {
  patternKey: string
  dimension: UxDimension
  severity: 'high' | 'medium' | 'low'
  kind: 'shared' | 'contradiction' | 'page'
  title: string
  problem: string
  fix: string
  pages: Array<{ key: string; label: string; issueTitle: string; evidence: string }>
  confidence: number
  evidenceSeen: boolean
}

/** Where a run's screens came from (ADR 0073): a browser, or a phone app's own screenshots. */
const UX_PLATFORMS = ['web', 'ios', 'android', 'flutter', 'react_native', 'capacitor', 'other'] as const
type UxPlatform = (typeof UX_PLATFORMS)[number]
type UxCaptureSource = 'playwright' | 'maestro' | 'adb' | 'simctl' | 'sdk' | 'other'

/** The server's capturesDetail labels, so the run line and its detail use the same words. */
const UX_PLATFORM_LABEL: Readonly<Record<UxPlatform, string>> = {
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
  flutter: 'Flutter',
  react_native: 'React Native',
  capacitor: 'Capacitor',
  other: 'App',
}

interface UxScorecardRun {
  local_run_id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped'
  model: string | null
  /** Null for a native capture run: it has screens, not a start page. */
  start_url: string | null
  detail: string | null
  counts: { pages?: number; scored?: number; failed?: number; mean?: number | null; causes?: number; prompt?: string } | null
  started_at: string
  finished_at: string | null
  error: string | null
  /** Absent on rows from before native captures: those are web runs. */
  platform?: UxPlatform | null
  device?: string | null
  capture_source?: UxCaptureSource | null
}

/** A run's platform; a missing or unknown one is a browser run. */
function runPlatform(run: Pick<UxScorecardRun, 'platform'>): UxPlatform {
  return run.platform && (UX_PLATFORMS as readonly string[]).includes(run.platform) ? run.platform : 'web'
}

/** "Android · Pixel 8", "iOS · iPhone 16 simulator", or null for a web run (it shows nothing extra). */
export function runPlatformLabel(run: Pick<UxScorecardRun, 'platform' | 'device'>): string | null {
  const platform = runPlatform(run)
  if (platform === 'web') return null
  const device = run.device?.trim()
  return device ? `${UX_PLATFORM_LABEL[platform]} · ${device}` : UX_PLATFORM_LABEL[platform]
}

/**
 * The run's detail without the platform and device, for a native run whose
 * badge already says them (the server writes "app · Android · Pixel 8 · viewport 390x844").
 */
export function runDetailWithoutPlatform(run: Pick<UxScorecardRun, 'platform' | 'device' | 'detail'>): string | null {
  if (!run.detail) return null
  const platform = runPlatform(run)
  if (platform === 'web') return run.detail
  const drop = new Set([UX_PLATFORM_LABEL[platform], run.device?.trim() ?? ''].filter(Boolean))
  const rest = run.detail
    .split(' · ')
    .filter((part) => !drop.has(part.trim()))
    .join(' · ')
  return rest || null
}

export interface UxScorecardData {
  run: UxScorecardRun | null
  runs: UxScorecardRun[]
  rows: UxScorecardRow[]
  unscored?: Array<{ key: string; label: string; status: string; note: string | null }>
  causes: UxScorecardCause[]
  reports: Array<{ id: string; title: string; status: string; severity: string | null; pattern_key: string | null; created_at: string }>
  viewport: string
  /** The rubric version of this run's scores; the trend only compares runs of the same version. */
  rubricVersion?: string | null
}

/** A score's tone: red when the page misleads or blocks (1–4), amber for a real problem (5–6), green otherwise. */
export function scoreTone(score: number): BadgeTone {
  if (score <= 4) return 'danger'
  if (score <= 6) return 'warn'
  return 'ok'
}

/** "+2", "−1", or null for no change or no earlier run. */
export function deltaLabel(delta: number | null): string | null {
  if (delta == null || delta === 0) return null
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`
}

/** The causes worth reading first: across pages or contradictions, before one-page ones. */
export function crossCuttingCauses(causes: readonly UxScorecardCause[]): UxScorecardCause[] {
  return causes.filter((c) => c.kind !== 'page')
}

/** The open report a cause was filed as, by pattern key. */
export function reportForCause(cause: Pick<UxScorecardCause, 'patternKey'>, reports: UxScorecardData['reports']): UxScorecardData['reports'][number] | null {
  return reports.find((r) => r.pattern_key === cause.patternKey) ?? null
}

/** The run's average, from its counts or its rows. */
export function runMean(data: Pick<UxScorecardData, 'run' | 'rows'>): number | null {
  const m = data.run?.counts?.mean
  if (typeof m === 'number') return m
  if (!data.rows.length) return null
  return Math.round((data.rows.reduce((n, r) => n + r.overall, 0) / data.rows.length) * 10) / 10
}
