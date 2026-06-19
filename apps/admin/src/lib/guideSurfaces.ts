/**
 * Opaque guide surfaces — page (surface) → panel (raised) → row (overlay or semantic muted).
 * Never use bg-transparent or alpha-mixed surface tokens here; they bleed the page gray through.
 */

/** Standalone guide on page bg — opaque raised panel with an `ok` accent edge. */
export const GUIDE_PANEL_SHELL_DEFAULT =
  'border border-ok/30 bg-surface-raised shadow-card'

/** Guide nested inside Card / Section (parent is already raised) — sits on page surface. */
export const GUIDE_PANEL_SHELL_INSET = 'border border-ok/25 bg-surface'

export const GUIDE_PANEL_SUMMARY_HOVER = 'hover:bg-ok-muted/35'

/** Neutral inset row inside a raised guide panel. */
export const GUIDE_STAGE_ROW_NEUTRAL = 'border-edge-subtle bg-surface-overlay'
