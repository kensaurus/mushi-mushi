/**
 * Pure helpers for heatmap / meter visuals in the triage table.
 * Keeps color thresholds aligned with `confidenceBadgeClass` + severity traffic.
 */

import { SEVERITY_TRAFFIC_ORDER, type SeverityTrafficKey } from '../../lib/severityTraffic'

const CONFIDENCE_SEGMENTS = 5

export function confidencePercent(confidence: number | null | undefined): number | null {
  if (confidence == null || Number.isNaN(confidence)) return null
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100)
}

/** Bar + segment fill tone for a 0–1 confidence score. */
export function confidenceBarTone(confidence: number): string {
  if (confidence >= 0.85) return 'bg-ok'
  if (confidence >= 0.65) return 'bg-warn'
  return 'bg-danger'
}

/** Subtle cell wash behind confidence meters — bordered so bars read on dark canvas. */
export function confidenceCellTint(confidence: number): string {
  if (confidence >= 0.85) return 'bg-ok-muted/45 border border-ok/25'
  if (confidence >= 0.65) return 'bg-warn-muted/45 border border-warn/25'
  return 'bg-danger-muted/45 border border-danger/25'
}

export function confidenceEmptySegmentTone(): string {
  return 'bg-fg-faint/20'
}

export function confidenceTextTone(pct: number): string {
  if (pct >= 85) return 'text-ok-foreground'
  if (pct >= 65) return 'text-warning-foreground'
  return 'text-danger-foreground'
}

/** Whether segment `index` (0..4) should render filled at `pct` (0–100). */
export function confidenceSegmentFilled(pct: number, index: number): boolean {
  const threshold = ((index + 1) / CONFIDENCE_SEGMENTS) * 100
  return pct >= threshold - 100 / CONFIDENCE_SEGMENTS + 1
}

export const CONFIDENCE_SEGMENT_COUNT = CONFIDENCE_SEGMENTS
/** @deprecated Prefer `CONFIDENCE_SEGMENT_COUNT` — alias for cell components. */
export const confidenceSegmentCount = CONFIDENCE_SEGMENT_COUNT

const SEVERITY_LEVELS: SeverityTrafficKey[] = SEVERITY_TRAFFIC_ORDER.filter(
  (k) => k !== 'unscored',
) as SeverityTrafficKey[]

export function severityActiveIndex(severity: string | null | undefined): number | null {
  if (!severity) return null
  const idx = SEVERITY_LEVELS.indexOf(severity as SeverityTrafficKey)
  return idx >= 0 ? idx : null
}

export const SEVERITY_LEVEL_KEYS = SEVERITY_LEVELS
/** @deprecated Prefer `SEVERITY_LEVEL_KEYS` — alias for cell components. */
export const severityLevelKeys = SEVERITY_LEVEL_KEYS

export type BlastIntensity = 'idle' | 'low' | 'medium' | 'high' | 'critical'

export function blastRadiusIntensity(value: number): BlastIntensity {
  if (value <= 1) return 'idle'
  if (value >= 10) return 'critical'
  if (value >= 5) return 'high'
  if (value >= 3) return 'medium'
  return 'low'
}

export function blastRadiusBlockTone(intensity: BlastIntensity, filled: boolean): string {
  if (!filled) return 'bg-edge-subtle/70'
  switch (intensity) {
    case 'critical':
      return 'bg-danger'
    case 'high':
      return 'bg-warn'
    case 'medium':
      return 'bg-brand/80'
    case 'low':
      return 'bg-info/70'
    default:
      return 'bg-edge-subtle/70'
  }
}

export function blastRadiusFilledBlocks(value: number, maxBlocks = 5): number {
  if (value <= 1) return 0
  return Math.min(maxBlocks, Math.max(1, Math.ceil(value / 2)))
}

export function recencyHours(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 0
  return ms / (1000 * 60 * 60)
}

/** 0–1 freshness for recency heat strip (1 = just arrived). */
export function recencyFreshness(hours: number): number {
  if (hours <= 6) return 1
  if (hours <= 24) return 0.75
  if (hours <= 72) return 0.45
  if (hours <= 168) return 0.25
  return 0.12
}

export function recencyBarTone(hours: number): string {
  if (hours <= 6) return 'bg-ok'
  if (hours <= 24) return 'bg-warn/90'
  if (hours <= 168) return 'bg-fg-faint/50'
  return 'bg-fg-faint/30'
}
