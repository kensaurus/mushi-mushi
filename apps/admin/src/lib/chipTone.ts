/**
 * WCAG AA chip / pill / tinted-surface copy — pair muted backgrounds with
 * *-foreground text tokens. Never use `text-accent` on `bg-accent/*` /
 * `bg-accent-muted` (fails on dark theme); `text-accent-foreground` is the
 * AA-safe copy token for those washes.
 */

export const CHIP_TONE = {
  accent: 'bg-accent-muted text-accent-foreground',
  accentSubtle: 'bg-accent-muted/60 text-accent-foreground',
  brand: 'bg-brand-subtle text-brand',
  brandSubtle: 'bg-brand/15 text-brand',
  warn: 'bg-warn-muted text-warn-foreground',
  warnSubtle: 'bg-warn-muted/60 text-warn-foreground',
  danger: 'bg-danger-muted text-danger-foreground',
  dangerSubtle: 'bg-danger-muted/60 text-danger-foreground',
  ok: 'bg-ok-muted text-ok-foreground',
  okSubtle: 'bg-ok-muted/60 text-ok-foreground',
  info: 'bg-info-muted text-info-foreground',
  infoSubtle: 'bg-info-muted/60 text-info-foreground',
  neutral: 'bg-surface-overlay text-fg-secondary',
} as const

/**
 * Soft selected / pressed chip on a plain surface (trigger pickers, filter
 * toggles). Prefer this over hand-rolled `bg-brand/12 text-brand border
 * border-brand/28` — `text-brand-foreground` clears WCAG AA on the muted
 * brand wash, and the recipe already owns its single border.
 */
export const SELECTED_TONE =
  'bg-brand-subtle text-brand-foreground border border-brand/40'

/** Idle companion for SELECTED_TONE on the same control set. */
export const SELECTED_TONE_IDLE =
  'border-edge-subtle bg-surface-raised text-fg-muted hover:text-fg'

/**
 * Header PageHeaderBar severity Badge fallbacks (brand / neutral) so pages
 * stop inlining non-tokenized class strings in severity ternaries.
 */
export const HEADER_BADGE_TONE = {
  brand: 'bg-surface-overlay text-fg-secondary',
  neutral: 'bg-surface-overlay text-fg-muted',
} as const

/** Links on plain (non-tinted) surfaces — accent hue, AA on surface bg. */
export const LINK_ACCENT =
  'text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity'

/** Inline meta chip tones for RecommendedAction / dashboards. */
export const META_CHIP_TONE = {
  neutral: CHIP_TONE.neutral,
  info: CHIP_TONE.infoSubtle,
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
} as const

/**
 * Pull-request lifecycle chips, GitHub's convention: open green, merged
 * violet (the accent hue), closed red, draft grey. One map, so a PR state
 * reads the same on every page. Job and release status lists, where
 * "merged" just means done, keep their own ok tone.
 */
export const PR_STATE_TONE_KEY = {
  draft: 'neutral',
  open: 'okSubtle',
  merged: 'accent',
  closed: 'dangerSubtle',
} as const satisfies Record<string, keyof typeof CHIP_TONE>

/** Chip classes for a PR state; undefined for a state GitHub doesn't define, so callers keep their own fallback. */
export function prStateChipTone(state: string | null | undefined): string | undefined {
  const key = state ? PR_STATE_TONE_KEY[state as keyof typeof PR_STATE_TONE_KEY] : undefined
  return key ? CHIP_TONE[key] : undefined
}

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

/**
 * Canonical run / job / lifecycle status → chip tone.
 *
 * Single source of truth for every status pill in the console (QA runs,
 * releases, experiments, compliance evidence, DSARs, storage health, support
 * tickets, feature tickets…). Pages must consume this instead of declaring
 * their own `Record<Status, string>` maps — that's how we ended up with
 * AA-failing `text-ok`-on-`bg-ok/10` chips in four different hues.
 */
const RUN_STATUS_SEVERITY: Record<string, StatusSeverity> = {
  // success family
  passed: 'ok', pass: 'ok', completed: 'ok', resolved: 'ok', published: 'ok',
  healthy: 'ok', done: 'ok', merged: 'ok', verified: 'ok', active: 'ok',
  connected: 'ok', success: 'ok', succeeded: 'ok', validated: 'ok',
  promoted: 'ok', classified: 'ok', fixed: 'ok',
  // GitHub PR lifecycle aliases (FixGitGraph) — open is healthy/green
  pr_open: 'ok', pr_merged: 'ok', pr_closed: 'neutral', pr_draft: 'warn',
  // failure family
  failed: 'danger', fail: 'danger', error: 'danger', failing: 'danger',
  rejected: 'danger', dead_letter: 'danger', critical: 'danger', blocked: 'danger',
  // attention family
  timeout: 'warn', degraded: 'warn', warn: 'warn', pending: 'warn',
  draft: 'warn', open: 'warn', high: 'warn', stale: 'warn', new: 'warn',
  // in-flight / informational family
  running: 'info', in_progress: 'info', queued: 'info', info: 'info',
  validating: 'info', deploying: 'info', syncing: 'info',
  exporting: 'info', exported: 'info', trained: 'info', fixing: 'info',
  // neutral / terminal-quiet family
  skipped: 'neutral', closed: 'neutral', cancelled: 'neutral', stopped: 'neutral',
  disabled: 'neutral', unknown: 'neutral', archived: 'neutral', optional: 'neutral',
  aborted: 'neutral', dismissed: 'neutral',
}

export function runStatusChipTone(status: string | null | undefined): string {
  if (!status) return CHIP_TONE.neutral
  return statusChipTone(RUN_STATUS_SEVERITY[status] ?? 'neutral')
}

/**
 * Surface severity tokens for hero / insight cards (ring + muted bg + fg + dot).
 * Consolidates ad-hoc SEVERITY_STYLE / insightTone maps — prefer this helper.
 */
export type SurfaceSeverity = 'ok' | 'info' | 'warn' | 'crit' | 'danger' | 'neutral'

export const SEVERITY_SURFACE: Record<
  SurfaceSeverity,
  { ring: string; bg: string; text: string; dot: string }
> = {
  ok: { ring: 'border-ok/40', bg: 'bg-ok-muted', text: 'text-ok-foreground', dot: 'bg-ok' },
  info: { ring: 'border-info/40', bg: 'bg-info-muted', text: 'text-info-foreground', dot: 'bg-info' },
  warn: { ring: 'border-warn/40', bg: 'bg-warn-muted', text: 'text-warn-foreground', dot: 'bg-warn' },
  crit: { ring: 'border-danger/40', bg: 'bg-danger-muted', text: 'text-danger-foreground', dot: 'bg-danger' },
  danger: { ring: 'border-danger/40', bg: 'bg-danger-muted', text: 'text-danger-foreground', dot: 'bg-danger' },
  neutral: {
    ring: 'border-edge',
    bg: 'bg-surface-raised',
    text: 'text-fg',
    dot: 'bg-fg-muted',
  },
}
