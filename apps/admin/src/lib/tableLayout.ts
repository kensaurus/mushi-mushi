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
  /** WCAG 2.5.8 floor — 24×24px. Icon buttons in these tables were 14–20px. */
  hit: 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm',
  /** Same floor for a control that also shows a word (Triage, Fix). */
  hitText: 'inline-flex min-h-6 shrink-0 items-center justify-center rounded-sm px-1.5',
} as const
