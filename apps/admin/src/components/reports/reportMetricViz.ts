/**
 * Pure helpers for heatmap / meter visuals in the triage table.
 * Keeps color thresholds aligned with `confidenceBadgeClass` + severity traffic.
 */

const CONFIDENCE_SEGMENTS = 5

export function confidencePercent(confidence: number | null | undefined): number | null {
  if (confidence == null || Number.isNaN(confidence)) return null
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100)
}

/*
 * Confidence is how sure the classifier is, not whether anything failed: a
 * red "55%" read as an error on a healthy row (R2 sweep 2026-11-18). High and
 * medium confidence are ink; only a low score (read the evidence before you
 * send a fix) is amber, the warning colour. Never red.
 */

/** Bar + segment fill tone for a 0–1 confidence score. */
export function confidenceBarTone(confidence: number): string {
  if (confidence >= 0.85) return 'bg-fg-secondary'
  if (confidence >= 0.65) return 'bg-fg-muted'
  return 'bg-warn'
}

/**
 * The bugs list shows confidence only below this (console UX pass
 * 2026-11-22): a "Conf." column read 95–100% on nearly every row, so it
 * said nothing and took width from the summary. A low score is the one
 * that changes what you do (read the evidence before you send a fix).
 */
const LOW_CONFIDENCE_BELOW = 0.8

/** True when a row should carry the low-confidence chip. */
export function isLowConfidence(confidence: number | null | undefined): confidence is number {
  return confidence != null && !Number.isNaN(confidence) && confidence < LOW_CONFIDENCE_BELOW
}

export function confidenceTextTone(pct: number): string {
  if (pct >= 85) return 'text-fg'
  if (pct >= 65) return 'text-fg-secondary'
  return 'text-warn-foreground'
}

/** Whether segment `index` (0..4) should render filled at `pct` (0–100). */
export function confidenceSegmentFilled(pct: number, index: number): boolean {
  const threshold = ((index + 1) / CONFIDENCE_SEGMENTS) * 100
  return pct >= threshold - 100 / CONFIDENCE_SEGMENTS + 1
}

export const CONFIDENCE_SEGMENT_COUNT = CONFIDENCE_SEGMENTS

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
