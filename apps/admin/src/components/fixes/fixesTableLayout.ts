import { TABLE_CELL } from '../../lib/tableLayout'

/** Shared column widths for the fix-attempts table — keep `<colgroup>`,
 *  `<th>`, and row `<td>` in sync under `table-layout: fixed`. */
export const FIXES_TABLE_COL = {
  stripe: 'w-1',
  status: 'w-[6.75rem]',
  report: 'w-[28rem]',
  pipeline: 'w-[6.5rem]',
  ci: 'w-[7rem]',
  started: 'w-[4.25rem]',
  action: 'w-[6.5rem]',
} as const

export { TABLE_CELL }

/** Pixel offsets for sticky lead columns (stripe + status + report). */
export const FIXES_STICKY_LEAD = {
  col2Left: '4px',
  col3Left: '7rem', /* w-1 + w-[6.75rem] */
} as const
