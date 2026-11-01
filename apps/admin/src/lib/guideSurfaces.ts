/**
 * Guide surfaces — one surface level per nesting step.
 *
 * Standalone guides are an opaque panel on the page; guides nested inside a
 * Card / Section add a hairline only. No `ok` green edge (that is the success
 * hue, not "help"), and no grey `bg-surface` / `bg-surface-overlay` fill inside
 * a raised card — in light mode that painted a darker grey slab inside a white
 * card, which read as the background bleeding through.
 */

/** Standalone guide on page bg — opaque raised panel. */
export const GUIDE_PANEL_SHELL_DEFAULT = 'border border-panel-border bg-panel'

/** Guide nested inside Card / Section (parent is already raised) — hairline only. */
export const GUIDE_PANEL_SHELL_INSET = 'border border-edge-subtle'

export const GUIDE_PANEL_SUMMARY_HOVER = 'hover:bg-surface-hover'

/** Neutral row inside a guide panel. */
export const GUIDE_STAGE_ROW_NEUTRAL = 'border-edge-subtle'
