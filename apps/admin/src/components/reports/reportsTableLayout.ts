/** Shared column widths for the triage table — keep `<colgroup>`, `<th>`,
 *  and row `<td>` in sync so header labels sit over their cell data under
 *  `table-layout: fixed`.
 *
 *  Widths are the minimum that fits the header word (with its sort arrow)
 *  and a 24px control. The table min-width is their sum, so fixed layout
 *  does not squeeze a column below that floor. Summary is the wide column;
 *  at 1440px the table still fits the content area beside the 240px sidebar.
 *  Narrower viewports scroll inside `.responsive-table-scroll`.
 */
import { TABLE_CELL } from '../../lib/tableLayout'

/** Column widths in rem. Multiples of 0.25 so the sum stays exact. */
export const REPORTS_COL_REM = {
  stripe: 0.25,
  /** 40px: a 24px checkbox, centered, with room for the cell edge. */
  checkbox: 2.5,
  summary: 34,
  /** Pipeline stepper (4 bars + stage fraction) — keep ≥5.75rem so bars stay legible. */
  status: 5.75,
  /** "SEVERITY" plus the sort arrow at text-2xs / tracking-wider. */
  severity: 6.75,
  /** "CONF." plus the sort arrow. */
  confidence: 4.5,
  /** Three 24px icon buttons plus the row action label ("Triage →"), after the 4px side insets. */
  action: 12,
} as const

const remWidth = (rem: number) => (rem === 0.25 ? 'w-1' : rem === 2.5 ? 'w-10' : `w-[${rem}rem]`)

export const REPORTS_TABLE_COL = {
  stripe: remWidth(REPORTS_COL_REM.stripe),
  checkbox: remWidth(REPORTS_COL_REM.checkbox),
  summary: remWidth(REPORTS_COL_REM.summary),
  status: remWidth(REPORTS_COL_REM.status),
  severity: remWidth(REPORTS_COL_REM.severity),
  confidence: remWidth(REPORTS_COL_REM.confidence),
  action: remWidth(REPORTS_COL_REM.action),
} as const

/** Pixel offsets for sticky lead columns (stripe + checkbox + summary). */
export const REPORTS_STICKY_LEAD = {
  col2Left: '4px',
  col3Left: `${REPORTS_COL_REM.stripe + REPORTS_COL_REM.checkbox}rem`,
} as const

export const REPORTS_TABLE_MIN_REM = (Object.values(REPORTS_COL_REM) as number[]).reduce((sum, rem) => sum + rem, 0)

export const REPORTS_TABLE_MIN_W = `min-w-[${REPORTS_TABLE_MIN_REM}rem]`

/** 24×24 CSS px — the layout probe's minimum tap target (WCAG 2.5.8). */
export const REPORTS_CHECKBOX = 'size-6 accent-brand'
export const REPORTS_HIT_ICON = 'inline-flex size-6 shrink-0 items-center justify-center'
export const REPORTS_HIT_LABEL = 'inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center'

/** Max width of the action stack (recency bar + CTA row + in-flow kebab). */
export const REPORTS_ACTION_STACK_MAX = 'max-w-full' as const

export { TABLE_CELL }
