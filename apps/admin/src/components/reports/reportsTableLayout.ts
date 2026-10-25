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
  stripe: 'w-1 max-md:w-auto',
  checkbox: 'w-8 max-md:w-auto',
  summary: 'w-[34rem] max-md:w-auto',
  /** Pipeline stepper (4 bars + stage fraction) — keep ≥5.75rem so bars stay legible. */
  status: 'w-[5.75rem] max-md:w-auto',
  severity: 'w-[3.25rem] max-md:w-auto',
  confidence: 'w-[3.5rem] max-md:w-auto',
  action: 'w-[7rem] max-md:w-auto',
} as const

/** Pixel offsets for sticky lead columns (stripe + checkbox + summary). */
export const REPORTS_STICKY_LEAD = {
  col2Left: '4px',
  col3Left: '2.25rem', /* w-1 + w-8 */
} as const

/** Desktop keeps the column sum; below `md` the row stacks and must not force a sideways page scroll. */
export const REPORTS_TABLE_MIN_W = 'min-w-[53.5rem] max-md:min-w-0'

/** Max width of the action stack (recency bar + CTA row + in-flow kebab). */
export const REPORTS_ACTION_STACK_MAX = 'max-w-[9.75rem]' as const

export { TABLE_CELL }
