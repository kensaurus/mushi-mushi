/**
 * The console's one tone scale for chips, tags, pills and inline banners.
 *
 * 2026-11-27 (owner: "bare background colour text on many of the uiux —
 * really bad — fix all of them universally"): every recipe is a tinted fill,
 * its `*-foreground` ink AND a 1px inset edge in the same hue
 * (`inset-ring inset-ring-<tone>-edge`). The fill alone read as a highlighter
 * stroke, not a component. The edge is inset, so nothing grows: the #1141
 * density rule ("contrast, weight and edges, never size") still holds. It is
 * Tailwind's separate inset-ring layer, not `ring-inset`: `ring-inset` would
 * also turn every `focus-visible:ring-2` focus ring inward.
 *
 * - Text on every fill clears WCAG AA (4.5:1) and every edge clears 3:1 on
 *   surface, raised and overlay, in light and dark:
 *   packages/server/src/__tests__/console-tone-contrast.test.ts.
 * - Never hand-roll `bg-*-muted text-*` or `bg-ok/15 text-ok`: use a tone here
 *   through `Badge`, `SeverityPill`, `Callout`, or the class string itself.
 *   `pnpm check:tinted-text` fails on a tinted fill with text and no edge.
 * - Don't append `border` / `ring-1` / `inset-ring` to a recipe: it carries its edge.
 * - The `*Subtle` (60 % alpha) and `brandSubtle` variants were folded into the
 *   solid tones (an alpha fill's contrast depends on what sits under it).
 */

export const CHIP_TONE = {
  ok: 'bg-ok-muted text-ok-foreground inset-ring inset-ring-ok-edge',
  warn: 'bg-warn-muted text-warn-foreground inset-ring inset-ring-warn-edge',
  danger: 'bg-danger-muted text-danger-foreground inset-ring inset-ring-danger-edge',
  info: 'bg-info-muted text-info-foreground inset-ring inset-ring-info-edge',
  accent: 'bg-accent-muted text-accent-foreground inset-ring inset-ring-accent-edge',
  brand: 'bg-brand-subtle text-brand-foreground inset-ring inset-ring-brand-edge',
  /** Medium severity (yellow), between High's warn and Low's ok. */
  medium: 'bg-sev-medium-muted text-sev-medium-foreground inset-ring inset-ring-sev-medium-edge',
  neutral: 'bg-surface-overlay text-fg-secondary inset-ring inset-ring-neutral-edge',
} as const

type ChipToneKey = keyof typeof CHIP_TONE

/**
 * Soft selected / pressed chip on a plain surface (trigger pickers, filter
 * toggles). Selection is the violet accent (DESIGN-SYSTEM "Red means a
 * failure"). The recipe owns its single border.
 */
export const SELECTED_TONE =
  'bg-accent-muted text-accent-foreground border border-accent-edge'

/** Idle companion for SELECTED_TONE on the same control set. */
export const SELECTED_TONE_IDLE =
  'border-edge-subtle bg-surface-raised text-fg-muted hover:text-fg'

/** Links on plain (non-tinted) surfaces — accent hue, AA on surface bg. */
export const LINK_ACCENT =
  'text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity'

/**
 * Pull-request lifecycle chips, GitHub's convention: open green, merged
 * violet (the accent hue), closed red, draft grey. One map, so a PR state
 * reads the same on every page. Job and release status lists, where
 * "merged" just means done, keep their own ok tone.
 */
export const PR_STATE_TONE_KEY = {
  draft: 'neutral',
  open: 'ok',
  merged: 'accent',
  closed: 'danger',
} as const satisfies Record<string, ChipToneKey>

/** Chip classes for a PR state; undefined for a state GitHub doesn't define, so callers keep their own fallback. */
export function prStateChipTone(state: string | null | undefined): string | undefined {
  const key = state ? PR_STATE_TONE_KEY[state as keyof typeof PR_STATE_TONE_KEY] : undefined
  return key ? CHIP_TONE[key] : undefined
}

/** Map IA severity labels to the canonical CHIP_TONE entry (consolidates ad-hoc pill classes). */
export type StatusSeverity = 'ok' | 'warn' | 'danger' | 'neutral' | 'info'

export function statusChipTone(severity: StatusSeverity): string {
  return CHIP_TONE[severity] ?? CHIP_TONE.neutral
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
  ok: { ring: 'border-ok-edge', bg: 'bg-ok-muted', text: 'text-ok-foreground', dot: 'bg-ok' },
  info: { ring: 'border-info-edge', bg: 'bg-info-muted', text: 'text-info-foreground', dot: 'bg-info' },
  warn: { ring: 'border-warn-edge', bg: 'bg-warn-muted', text: 'text-warn-foreground', dot: 'bg-warn' },
  crit: { ring: 'border-danger-edge', bg: 'bg-danger-muted', text: 'text-danger-foreground', dot: 'bg-danger' },
  danger: { ring: 'border-danger-edge', bg: 'bg-danger-muted', text: 'text-danger-foreground', dot: 'bg-danger' },
  neutral: {
    ring: 'border-neutral-edge',
    bg: 'bg-surface-raised',
    text: 'text-fg',
    dot: 'bg-fg-muted',
  },
}

/**
 * Bug severity as a chip tone and a shape (WCAG 1.4.1: never colour alone).
 * The same hues as the intent-coloured actions: Crit = Fix red, High =
 * Triage amber (lib/actionIntent.ts). Rendered by `SeverityPill`.
 */
const SEVERITY_TONE = {
  critical: { tone: 'danger', glyph: '▲', label: 'Critical', short: 'Crit' },
  high: { tone: 'warn', glyph: '◆', label: 'High', short: 'High' },
  medium: { tone: 'medium', glyph: '●', label: 'Medium', short: 'Med' },
  low: { tone: 'ok', glyph: '○', label: 'Low', short: 'Low' },
  unscored: { tone: 'neutral', glyph: '·', label: 'Not scored', short: '—' },
} as const satisfies Record<string, { tone: ChipToneKey; glyph: string; label: string; short: string }>

type SeverityToneKey = keyof typeof SEVERITY_TONE

export function severityTone(severity: string | null | undefined): (typeof SEVERITY_TONE)[SeverityToneKey] {
  return SEVERITY_TONE[(severity ?? 'unscored') as SeverityToneKey] ?? SEVERITY_TONE.unscored
}

/** Chip classes for a bug severity (critical / high / medium / low). */
export function severityChipTone(severity: string | null | undefined): string {
  return CHIP_TONE[severityTone(severity).tone]
}
