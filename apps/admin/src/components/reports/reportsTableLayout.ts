/** Shared column widths for the triage table — keep `<colgroup>`, `<th>`,
 *  and row `<td>` in sync so header labels sit over their cell data under
 *  `table-layout: fixed`. */
export const REPORTS_TABLE_COL = {
  stripe: 'w-1',
  checkbox: 'w-8',
  summary: 'min-w-0',
  status: 'w-[7.5rem]',
  severity: 'w-[5.5rem]',
  confidence: 'w-[4.5rem]',
  created: 'w-[5.5rem]',
  action: 'w-[9.5rem]',
} as const
