/** Shared column widths for the triage table — keep `<colgroup>`, `<th>`,
 *  and row `<td>` in sync so header labels sit over their cell data under
 *  `table-layout: fixed`.
 *
 *  Meta columns (status / severity / confidence) are sized to their content
 *  so summary absorbs the freed horizontal space instead of leaving dead
 *  gutters beside tiny heat strips.
 */
import { TABLE_CELL } from '../../lib/tableLayout'

export const REPORTS_TABLE_COL = {
  stripe: 'w-1',
  /** 24px checkbox plus a little inset. Sticky offset below must match. */
  checkbox: 'w-10',
  summary: 'w-[34rem]',
  /** Pipeline stepper (4 bars + stage fraction) — keep ≥5.75rem so bars stay legible. */
  status: 'w-[5.75rem]',
  severity: 'w-[3.25rem]',
  confidence: 'w-[3.5rem]',
  /** Three 24px kebab hits plus the row CTA. */
  action: 'w-[9.5rem]',
} as const

/** 24×24px floor (WCAG 2.5.8) for row controls on /reports. */
export const REPORTS_HIT = 'min-h-6 min-w-6'
/** Native checkbox box. `min-h`/`min-w` do not size the control. */
export const REPORTS_CHECKBOX = 'h-6 w-6'

/** Pixel offsets for sticky lead columns (stripe + checkbox + summary). */
export const REPORTS_STICKY_LEAD = {
  col2Left: '4px',
  col3Left: '2.75rem', /* w-1 + w-10 */
} as const

/**
 * Wide-table floor. `components.css` stacks the triage table when the
 * `reports-table` container is at most this wide — keep the two in sync.
 */
export const REPORTS_TABLE_MIN_W = 'min-w-[56.5rem]'

/** Max width of the action stack (recency bar + CTA row + in-flow kebab). */
export const REPORTS_ACTION_STACK_MAX = 'max-w-[9.75rem]' as const

export { TABLE_CELL }
