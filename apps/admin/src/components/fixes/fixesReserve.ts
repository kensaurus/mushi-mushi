/**
 * FILE: apps/admin/src/components/fixes/fixesReserve.ts
 * PURPOSE: Shared boxes for the /fixes skeleton, the stats placeholder, and
 *          the loaded banner, snapshot, and merge queue.
 *
 * OVERVIEW:
 * - The attempt list sits under these blocks. The skeleton and the loaded
 *   blocks use the same min-heights so swapping one for the other does not
 *   move the list.
 * - Beginner is the only live console mode: a status banner, a 6-tile
 *   snapshot, and no snapshot footer links. Heights assume border-box.
 *
 * USAGE:
 * - FixesPage skeleton and stats placeholder
 * - FixesStatusBanner, FixesSnapshotStrip, MergeQueuePanel
 *
 * NOTES:
 * - Banner: below `sm` the shell stacks (padding, two text lines, the
 *   action). From `sm` it is one row.
 * - Summary: section chrome plus `min-h-28` tiles. Two columns below `sm`
 *   (three rows), three until `lg` (two rows), six from `lg`.
 * - Queue: header, release control, the train sentence, and one row.
 *   More rows still grow the card. The skeleton reserves this box; an
 *   empty queue renders nothing, so that box drops when the panel is absent.
 */

/** Below `sm` the banner stacks; from `sm` it is one row. */
export const FIXES_BANNER_RESERVE = 'min-h-40 sm:min-h-16'

/** One stat tile: label, text-xl value, and a detail line that may wrap. */
export const FIXES_STAT_TILE_RESERVE = 'min-h-28'

/**
 * Snapshot section. Two columns below `sm`, three until `lg`, six from `lg`,
 * plus the section header.
 */
export const FIXES_SUMMARY_RESERVE = 'min-h-112 sm:min-h-80 lg:min-h-48'

/** Caps the skeleton at that same box so its tiles cannot grow past it. */
export const FIXES_SUMMARY_SKELETON = `${FIXES_SUMMARY_RESERVE} max-h-112 sm:max-h-80 lg:max-h-48 overflow-hidden`

/** Merge-queue card: header, release control, train sentence, one row. */
export const FIXES_QUEUE_RESERVE = 'min-h-72 lg:min-h-56'
