/** Shared column widths for the triage table — keep `<colgroup>`, `<th>`,
 *  and row `<td>` in sync so header labels sit over their cell data under
 *  `table-layout: fixed`.
 *
 *  Meta columns (status / severity / action) are sized to their content.
 *  Summary has no width of its own, so under `table-layout: fixed` it takes
 *  every pixel the others leave. The "Conf." column is gone (console UX pass
 *  2026-11-22): a low score shows as a chip in the summary instead.
 */
import { TABLE_CELL } from '../../lib/tableLayout'

export const REPORTS_TABLE_COL = {
  stripe: 'w-1',
  checkbox: 'w-8',
  /** Auto: absorbs the rest of the row (REPORTS_TABLE_MIN_W keeps it ≥ ~34rem). */
  summary: 'w-auto',
  /** Status word above the 4-step bar and "n of 4": "Classified" fits on one line. */
  status: 'w-[7rem]',
  severity: 'w-[3.25rem]',
  action: 'w-[7rem]',
} as const

/** Pixel offsets for sticky lead columns (stripe + checkbox + summary). */
export const REPORTS_STICKY_LEAD = {
  col2Left: '4px',
  col3Left: '2.25rem', /* w-1 + w-8 */
} as const

/** Lead (2.25rem) + summary floor (34rem) + status, severity, action (17.25rem). */
export const REPORTS_TABLE_MIN_W = 'min-w-[53.5rem]'

/** Max width of the action stack (recency bar + CTA row + in-flow kebab). */
export const REPORTS_ACTION_STACK_MAX = 'max-w-[9.75rem]' as const

export { TABLE_CELL }
