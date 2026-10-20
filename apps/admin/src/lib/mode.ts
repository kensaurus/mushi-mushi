/**
 * FILE: apps/admin/src/lib/mode.ts
 * PURPOSE: The console has one mode.
 *
 * Until the 2026-10-20 console audit the sidebar had three global modes
 * (Quick / Beginner / Advanced) that changed which pages existed, how pages
 * were named and how much copy they carried. Users said the console was
 * "hard to grasp"; the modes were a large part of why (five navigation
 * levels, a page that vanished when you switched, four names per page).
 * Progressive disclosure splits tasks by frequency, not people by skill
 * (Nielsen, 2026): the sidebar now always lists the same nine pages, and
 * everything else is a per-feature Lab (lib/labs.ts, Settings › Labs).
 *
 * The hook stays so the ~40 per-page copy modules keep compiling while they
 * are folded into one voice; it always answers "beginner" (the plain
 * language variant), never writes storage, and the setters are no-ops.
 */

export type AdminMode = 'quickstart' | 'beginner' | 'advanced'

/** The one mode every account gets. */
const ADMIN_MODE: AdminMode = 'beginner'

export interface UseAdminModeResult {
  mode: AdminMode
  /** No-op: the mode cannot be changed. Kept for call-site compatibility. */
  setMode: (mode: AdminMode) => void
  /** No-op: the mode cannot be changed. */
  toggle: () => void
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
}

const FROZEN: UseAdminModeResult = Object.freeze({
  mode: ADMIN_MODE,
  setMode: () => {},
  toggle: () => {},
  isQuickstart: false,
  isBeginner: true,
  isAdvanced: false,
})

export function useAdminMode(): UseAdminModeResult {
  return FROZEN
}
