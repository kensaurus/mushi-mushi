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
  checkbox: 'w-8',
  summary: 'w-[34rem]',
  status: 'w-[4.25rem]',
  severity: 'w-[3.25rem]',
  confidence: 'w-[3.5rem]',
  action: 'w-[7rem]',
} as const

/** Pixel offsets for sticky lead columns (stripe + checkbox + summary). */
export const REPORTS_STICKY_LEAD = {
  col2Left: '4px',
  col3Left: '2.25rem', /* w-1 + w-8 */
} as const

export const REPORTS_TABLE_MIN_W = 'min-w-[52rem]'

/** Reusable cell classes — numeric columns right-align header + body. */
export const REPORTS_NUMERIC_CELL = TABLE_CELL.numeric
export const REPORTS_META_CELL = TABLE_CELL.meta

/** Next step — CTA pinned top, age bar pinned bottom of row. */
export const REPORTS_ACTION_CELL =
  `${TABLE_CELL.actionStretch} text-right whitespace-nowrap`

/** Max width of the action stack (recency bar + CTA row + in-flow kebab). */
export const REPORTS_ACTION_STACK_MAX = 'max-w-[9.75rem]' as const

export { TABLE_CELL }
