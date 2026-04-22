/**
 * FILE: apps/admin/src/lib/pdcaStamp.ts
 * PURPOSE: Single source of truth for the visual language of a PDCA stage
 *          status stamp ("Closed", "In flight", "Failed", "Not yet").
 *
 *          Three surfaces consume these tokens — PdcaReceipt (fix row strip),
 *          PdcaReceiptStrip (report-detail compact grid), and ReportPdcaStory
 *          (storytelling vertical timeline). Keeping the palette + icon map
 *          in one file means "done" always reads the same green-glow across
 *          every page, and adding a new stamp (e.g. 'skipped') is a
 *          single-line change.
 *
 *          Design goals:
 *            - `done` is the loudest state — saturated fill + box-shadow glow
 *              + filled ✓ icon. Users scanning a long /fixes list should be
 *              able to see "which rows are closed" at a glance.
 *            - `idle` is the quietest — dashed border, faint text, no fill.
 *              It should fade into the background so the eye jumps to what
 *              actually needs attention.
 *            - `pending` and `failed` sit between the two, each tinted with
 *              their semantic colour but *without* the glow reserved for
 *              finished work. `pending` additionally animates (mushi-pulse)
 *              to signal live activity.
 */

export type StageStamp = 'done' | 'pending' | 'failed' | 'idle'

interface StampVisual {
  /** Full card shell — border, optional tint fill, optional glow. */
  shell: string
  /** Dot / icon fill colour. */
  dot: string
  /** Ring used when the dot is rendered as a decorated circle. */
  ring: string
  /** Text colour for the stamp label ("Closed", "In flight"…). */
  copy: string
  /** Human-readable stamp label. */
  label: string
  /** Glyph used in the compact stamp rows (keyed off `label`). */
  glyph: string
  /** True if the dot should animate (in-flight only). */
  pulse: boolean
}

export const STAMP_VISUAL: Record<StageStamp, StampVisual> = {
  done: {
    shell: 'border-ok/45 bg-ok/5 mushi-glow-ok',
    dot: 'bg-ok',
    ring: 'ring-ok/40',
    copy: 'text-ok',
    label: 'Closed',
    glyph: '✓',
    pulse: false,
  },
  pending: {
    shell: 'border-info/40 bg-info/5 mushi-glow-info',
    dot: 'bg-info',
    ring: 'ring-info/40',
    copy: 'text-info',
    label: 'In flight',
    glyph: '⧗',
    pulse: true,
  },
  failed: {
    shell: 'border-danger/45 bg-danger/5 mushi-glow-danger',
    dot: 'bg-danger',
    ring: 'ring-danger/40',
    copy: 'text-danger',
    label: 'Failed',
    glyph: '✕',
    pulse: false,
  },
  idle: {
    shell: 'border-dashed border-edge-subtle bg-transparent',
    dot: 'bg-fg-faint/50',
    ring: 'ring-edge',
    copy: 'text-fg-faint',
    label: 'Not yet',
    glyph: '○',
    pulse: false,
  },
}
