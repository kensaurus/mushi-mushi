/**
 * Shared table cell rhythm for admin data tables (Reports, Fixes, …).
 * Pair with per-table `*TABLE_COL` width maps and `ResponsiveTable`.
 */

export const TABLE_CELL = {
  pxLead: 'px-1.5',
  pxMeta: 'px-1',
  pxBody: 'px-2',
  meta: 'align-middle whitespace-nowrap overflow-hidden',
  numeric: 'text-right align-middle whitespace-nowrap tabular-nums overflow-hidden',
  /** Stretch cell to row height, then center inner content with a flex wrapper. */
  vCenter: 'align-middle h-px',
  /** Stretch `<td>` to full row height; inner stack uses `h-full flex-col justify-between`. */
  actionStretch: 'align-top h-px',
} as const
