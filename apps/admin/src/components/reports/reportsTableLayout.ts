/**
 * FILE: reportsTableLayout.ts
 * PURPOSE: Shared column widths for the reports triage table, plus the
 *          scrollport width at which the sticky summary column would cover
 *          the sort headers.
 *
 * OVERVIEW:
 * - `<colgroup>`, `<th>`, and row `<td>` share `REPORTS_TABLE_COL` so labels
 *   sit over their cells under `table-layout: fixed`.
 * - Meta columns are sized to their content; summary takes the rest.
 * - `reportsStickySummaryUnpinMaxRem` is the widest scrollport that still
 *   leaves a sort-header center under the sticky 34rem summary. The triage
 *   CSS unpins that column at this width (phone-width hit targets).
 *
 * DEPENDENCIES: `TABLE_CELL` from `lib/tableLayout`. Tailwind spacing
 * (`w-1` = 0.25rem) for the stripe and checkbox columns.
 *
 * NOTES: Column order is stripe, checkbox, summary, then the sort headers.
 * The sticky rule in `styles/components.css` pins nth-child(3) (summary).
 */
import { TABLE_CELL } from '../../lib/tableLayout'

export const REPORTS_TABLE_COL = {
  stripe: 'w-1',
  checkbox: 'w-8',
  summary: 'w-[34rem]',
  /** Pipeline stepper (4 bars + stage fraction) — keep ≥5.75rem so bars stay legible. */
  status: 'w-[5.75rem]',
  severity: 'w-[3.25rem]',
  confidence: 'w-[3.5rem]',
  action: 'w-[7rem]',
} as const

const COL_ORDER = ['stripe', 'checkbox', 'summary', 'status', 'severity', 'confidence', 'action'] as const
export type ReportsSortHeaderCol = 'status' | 'severity' | 'confidence' | 'action'

/** Tailwind default spacing step. `w-1` is 0.25rem, `w-8` is 2rem. */
const TW_SPACING_REM = 0.25

/** Width in rem for a `REPORTS_TABLE_COL` class (`w-N` or `w-[Nrem]`). */
export function reportsColRem(className: string): number {
  const arbitrary = className.match(/(?:^|\s)w-\[(\d+(?:\.\d+)?)rem\]/)
  if (arbitrary) return Number(arbitrary[1])
  const step = className.match(/(?:^|\s)w-(\d+)(?:\s|$)/)
  if (step) return Number(step[1]) * TW_SPACING_REM
  throw new Error(`No width in column class: ${className}`)
}

function colWidthsPx(rootPx: number): number[] {
  return COL_ORDER.map((key) => reportsColRem(REPORTS_TABLE_COL[key]) * rootPx)
}

/**
 * True when a sticky summary column paints over this sort header's center
 * after the table is scrolled as far right as the scrollport allows.
 * A center on the summary's right edge counts as covered: that cell has
 * the higher z-index, so `elementFromPoint` hits the summary, not the button.
 */
export function reportsSortHeaderCenterCovered(
  scrollportPx: number,
  header: ReportsSortHeaderCol,
  rootPx = 16,
): boolean {
  if (!(scrollportPx > 0)) return false
  const widths = colWidthsPx(rootPx)
  const index = COL_ORDER.indexOf(header)
  const table = widths.reduce((sum, w) => sum + w, 0)
  const maxScroll = Math.max(0, table - scrollportPx)
  let start = 0
  for (let i = 0; i < index; i++) start += widths[i]
  const center = start + widths[index] / 2
  const stickyRight = widths[0] + widths[1] + widths[2]
  return center - maxScroll <= stickyRight
}

/**
 * Widest scrollport, in px, at which the sticky summary still covers the
 * Status header center (the leftmost sort header, so the last one to clear).
 */
export function reportsStickySummaryUnpinMaxPx(rootPx = 16): number {
  const widths = colWidthsPx(rootPx)
  const stickyRight = widths[0] + widths[1] + widths[2]
  const trailing = widths.slice(3)
  const trailingSum = trailing.reduce((sum, w) => sum + w, 0)
  return stickyRight + trailingSum - trailing[0] / 2
}

/** Same threshold in rem, for the container query in `components.css`. */
export function reportsStickySummaryUnpinMaxRem(): number {
  return reportsStickySummaryUnpinMaxPx(1)
}

/** Pixel offsets for sticky lead columns (stripe + checkbox + summary). */
export const REPORTS_STICKY_LEAD = {
  col2Left: '4px',
  col3Left: '2.25rem', /* w-1 + w-8 */
} as const

export const REPORTS_TABLE_MIN_W = 'min-w-[53.5rem]'

/** Max width of the action stack (recency bar + CTA row + in-flow kebab). */
export const REPORTS_ACTION_STACK_MAX = 'max-w-[9.75rem]' as const

export { TABLE_CELL }
