import { CHIP_TONE } from './chipTone'

export const SEVERITY: Record<string, string> = {
  critical: CHIP_TONE.danger,
  high: CHIP_TONE.warn,
  medium: CHIP_TONE.brandSubtle,
  low: CHIP_TONE.ok,
}

export const STATUS: Record<string, string> = {
  new: CHIP_TONE.warnSubtle,
  queued: 'bg-warn-muted/60 text-warning-foreground border border-warn/20',
  classified: CHIP_TONE.okSubtle,
  fixing: CHIP_TONE.accentSubtle,
  fixed: CHIP_TONE.infoSubtle,
  verified: CHIP_TONE.okSubtle,
  reopened: CHIP_TONE.warnSubtle,
  resolved: CHIP_TONE.okSubtle,
  dismissed: CHIP_TONE.neutral,
}

export const PIPELINE_STATUS: Record<string, string> = {
  pending: CHIP_TONE.warnSubtle,
  running: CHIP_TONE.infoSubtle,
  exporting: CHIP_TONE.infoSubtle,
  exported: CHIP_TONE.infoSubtle,
  training: CHIP_TONE.accentSubtle,
  trained: CHIP_TONE.accentSubtle,
  validating: CHIP_TONE.infoSubtle,
  validated: CHIP_TONE.okSubtle,
  promoted: CHIP_TONE.okSubtle,
  rejected: CHIP_TONE.dangerSubtle,
  completed: CHIP_TONE.okSubtle,
  merged: CHIP_TONE.okSubtle,
  failed: CHIP_TONE.dangerSubtle,
  error: CHIP_TONE.dangerSubtle,
  dead_letter: CHIP_TONE.dangerSubtle,
  skipped: CHIP_TONE.warnSubtle,
  skipped_no_context: CHIP_TONE.warnSubtle,
  skipped_no_sandbox: CHIP_TONE.warnSubtle,
  skipped_unsupported_agent: CHIP_TONE.warnSubtle,
}

export const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug',
  slow: 'Slow',
  visual: 'Visual',
  confusing: 'Confusing UX',
  other: 'Other',
}

/** Badge chrome per category — pairs with `SEVERITY` for scan-friendly triage rows. */
export const CATEGORY_BADGE: Record<string, string> = {
  bug: CHIP_TONE.dangerSubtle,
  slow: CHIP_TONE.warnSubtle,
  visual: CHIP_TONE.infoSubtle,
  confusing: CHIP_TONE.accentSubtle,
  other: CHIP_TONE.neutral,
}

/** Styling for LLM confidence percentage chips (0–1). */
export function confidenceBadgeClass(c: number | null | undefined): string {
  if (c == null) return CHIP_TONE.neutral
  if (c >= 0.85) return CHIP_TONE.okSubtle
  if (c >= 0.65) return CHIP_TONE.warnSubtle
  return CHIP_TONE.dangerSubtle
}

/**
 * Color-grade a percentage into a Tailwind text tone token.
 *
 * Two directions so callers don't have to invert the input before
 * mapping — success/coverage reads greener as it grows, error/failure
 * reads redder. Thresholds use inclusive-upper boundaries (>=) for
 * "higher-better" and inclusive-lower for "lower-better" so a
 * borderline value picks the *more optimistic* bucket (25 % error is
 * still `warn`, not `danger`).
 *
 * @param value  Percentage expressed as 0–100 (so callers can skip the
 *               `* 100` dance when the UI already has a rendered %).
 * @param direction `higher-better` = success, uptime, quality score.
 *                  `lower-better` = error rate, latency %, drift.
 */
export function pctToneClass(
  value: number | null | undefined,
  direction: 'higher-better' | 'lower-better' = 'higher-better',
): string {
  if (value == null || Number.isNaN(value)) return 'text-fg-muted'
  if (direction === 'higher-better') {
    if (value >= 90) return 'text-ok-foreground'
    if (value >= 70) return 'text-warning-foreground'
    return 'text-danger-foreground'
  }
  if (value <= 1) return 'text-ok-foreground'
  if (value <= 5) return 'text-warning-foreground'
  return 'text-danger-foreground'
}

/**
 * A softer glow ring for cards/tickets that carry a severity or status
 * signal. Pairs with the left-edge stripe so a scan picks up red/amber
 * rows even from the far side of a 4K monitor. Keep the shadow subtle
 * (shadow-[color]/20) so adjacent non-critical rows don't feel noisy.
 *
 * Falls back to the neutral card edge when the input doesn't map.
 */
export function severityGlowClass(sev: string | null | undefined): string {
  switch (sev) {
    case 'critical':
      return 'ring-1 ring-danger/40 shadow-[0_0_0_1px_rgba(0,0,0,0)] shadow-danger/10'
    case 'high':
      return 'ring-1 ring-warn/35 shadow-warn/10'
    case 'medium':
      return 'ring-1 ring-warn/20'
    case 'low':
      return 'ring-1 ring-info/25'
    default:
      return ''
  }
}

/** Parallel helper for in-flight status glow (fixes, dispatches, jobs). */
export function statusGlowClass(status: string | null | undefined): string {
  switch (status) {
    case 'failed':
    case 'error':
    case 'dead_letter':
    case 'rejected':
      return 'ring-1 ring-danger/35 shadow-danger/10'
    case 'running':
    case 'fixing':
    case 'validating':
    case 'training':
      return 'ring-1 ring-info/30 shadow-info/5 motion-safe:animate-[pulse_4s_ease-in-out_infinite]'
    case 'completed':
    case 'fixed':
    case 'promoted':
    case 'validated':
    case 'resolved':
    case 'success':
      return 'ring-1 ring-ok/25'
    case 'new':
    case 'pending':
    case 'queued':
      return 'ring-1 ring-warn/25'
    default:
      return ''
  }
}

export const STATUS_LABELS: Record<string, string> = {
  new:        'New',
  queued:     'Queued',
  classified: 'Classified',
  fixing:     'Fixing',
  fixed:      'Fixed',
  verified:   'Verified',
  reopened:   'Reopened',
  dismissed:  'Dismissed',
  submitted:  'New',
  pending:    'New',
  triaged:    'Classified',
  grouped:    'Classified',
  dispatched: 'Classified',
  resolved:   'Fixed',
  completed:  'Fixed',
}

export const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
}

export const PIPELINE_STATUS_LABELS: Record<string, string> = {
  pending:     'Pending',
  running:     'Running',
  exporting:   'Exporting',
  exported:    'Exported',
  training:    'Training',
  trained:     'Trained',
  validating:  'Validating',
  validated:   'Validated',
  promoted:    'Promoted',
  rejected:    'Rejected',
  completed:          'Completed',
  merged:             'Merged',
  failed:             'Failed',
  error:              'Error',
  dead_letter:        'Dead letter',
  skipped:                   'Skipped',
  skipped_no_context:        'Skipped (no context)',
  skipped_no_sandbox:        'Skipped (no sandbox)',
  skipped_unsupported_agent: 'Skipped (unsupported agent)',
}

export function statusLabel(s: string | null | undefined): string {
  if (!s) return 'Unset'
  return STATUS_LABELS[s] ?? s
}

export function severityLabel(s: string | null | undefined): string {
  if (!s) return 'Unset'
  return SEVERITY_LABELS[s] ?? s
}

export function pipelineStatusLabel(s: string | null | undefined): string {
  if (!s) return '—'
  return PIPELINE_STATUS_LABELS[s] ?? s
}

export const FILTER_OPTIONS = {
  categories: ['', 'bug', 'slow', 'visual', 'confusing', 'other'],
  statuses:   ['', 'new', 'queued', 'classified', 'fixing', 'fixed', 'dismissed'],
  severities: ['', 'critical', 'high', 'medium', 'low'],
} as const

export const NODE_COLORS: Record<string, string> = {
  report_group: 'oklch(0.65 0.22 25)',
  component:    'oklch(0.68 0.16 240)',
  page:         'oklch(0.72 0.19 155)',
  version:      'oklch(0.80 0.15 80)',
  app:          'oklch(0.62 0.18 310)',
  page_v2:      'oklch(0.72 0.14 190)',
  element:      'oklch(0.68 0.15 50)',
  action:       'oklch(0.72 0.2 25)',
  api_dep:      'oklch(0.65 0.14 240)',
  db_dep:       'oklch(0.7 0.12 300)',
  test:         'oklch(0.75 0.16 145)',
  user_story:   'oklch(0.78 0.12 85)',
}

export const SCORE_COLORS: Record<string, string> = {
  overall:   'oklch(0.58 0.22 280)',
  accuracy:  'oklch(0.68 0.16 240)',
  severity:  'oklch(0.65 0.22 25)',
  component: 'oklch(0.72 0.19 155)',
  repro:     'oklch(0.80 0.15 80)',
}

export { CHIP_TONE, LINK_ACCENT, LINK_BRAND, META_CHIP_TONE } from './chipTone'
