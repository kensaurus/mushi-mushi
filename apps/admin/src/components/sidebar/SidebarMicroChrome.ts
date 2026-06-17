/**
 * FILE: apps/admin/src/components/sidebar/SidebarMicroChrome.ts
 * PURPOSE: Shared sidebar segmented-control tokens — track + segment classes.
 *
 * Visual system (see index.css `.sidebar-micro-*`):
 * - Track: inset well with border
 * - Sliding pill: Framer `layoutId` indicator (MicroSegmentedTrack)
 * - Segment default: muted label/icon
 * - Hover: lifted surface on inactive; brightens label on active
 * - Selected (sliding): semibold label; pill carries fill
 * - Selected (non-sliding): brand-tinted fill on segment
 * - Press: subtle scale-down (CSS + Framer whileTap)
 */

/** Inset track wrapping equal-width segments. */
export const MICRO_TRACK = 'sidebar-micro-track'

/** Sliding-pill mode — active segment background defers to `.sidebar-micro-indicator`. */
export const MICRO_TRACK_SLIDING = 'sidebar-micro-track--sliding'

/** Toolbar-inline width (table density, etc.). */
export const MICRO_TRACK_INLINE = 'sidebar-micro-track--inline'

/** Flex cell hosting one segment + optional sliding indicator. */
export const MICRO_SEG_CELL = 'sidebar-micro-seg-cell'

/** Single segment — pair with `microSegActive(checked)`. */
export const MICRO_SEG = 'sidebar-micro-seg'

export function microSegActive(active: boolean): string {
  return active ? 'sidebar-micro-seg--active' : ''
}

/** Optional label wrapper inside a text segment. */
export const MICRO_SEG_LABEL =
  'sidebar-micro-seg__label min-w-0 truncate text-3xs font-medium leading-none'
