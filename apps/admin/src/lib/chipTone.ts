/**
 * WCAG AA chip / pill / tinted-surface copy — pair muted backgrounds with
 * *-foreground text tokens. Never use `text-accent` or `text-accent-foreground`
 * on `bg-accent/*` / `bg-accent-muted` (fails on dark theme).
 */

export const CHIP_TONE = {
  accent: 'bg-accent-muted/70 text-accent-foreground border border-accent/35',
  accentSubtle: 'bg-accent-muted/55 text-accent-foreground border border-accent/30',
  brand: 'bg-brand-subtle/85 text-brand border border-brand/30',
  brandSubtle: 'bg-brand/12 text-brand border border-brand/28',
  warn: 'bg-warn-muted/70 text-warning-foreground border border-warn/30',
  warnSubtle: 'bg-warn-muted/50 text-warning-foreground border border-warn/25',
  danger: 'bg-danger-muted/70 text-danger-foreground border border-danger/30',
  dangerSubtle: 'bg-danger-muted/50 text-danger-foreground border border-danger/25',
  ok: 'bg-ok-muted/70 text-ok-foreground border border-ok/30',
  okSubtle: 'bg-ok-muted/50 text-ok-foreground border border-ok/25',
  info: 'bg-info-muted/70 text-info-foreground border border-info/30',
  infoSubtle: 'bg-info-muted/50 text-info-foreground border border-info/25',
  neutral: 'bg-surface-overlay text-fg-secondary border border-edge-subtle',
} as const

/** Links on plain (non-tinted) surfaces — accent hue, AA on surface bg. */
export const LINK_ACCENT =
  'text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors'

export const LINK_BRAND =
  'text-brand hover:text-brand-hover underline underline-offset-2 motion-safe:transition-colors'

/** Inline meta chip tones for RecommendedAction / dashboards. */
export const META_CHIP_TONE = {
  neutral: CHIP_TONE.neutral,
  info: CHIP_TONE.infoSubtle,
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
} as const

/** Map IA severity labels to the canonical CHIP_TONE entry (consolidates ad-hoc pill classes). */
export type StatusSeverity = 'ok' | 'warn' | 'danger' | 'neutral' | 'info'

export function statusChipTone(severity: StatusSeverity): string {
  switch (severity) {
    case 'ok':
      return CHIP_TONE.okSubtle
    case 'warn':
      return CHIP_TONE.warnSubtle
    case 'danger':
      return CHIP_TONE.dangerSubtle
    case 'info':
      return CHIP_TONE.infoSubtle
    default:
      return CHIP_TONE.neutral
  }
}
