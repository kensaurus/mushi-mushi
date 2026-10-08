/**
 * FILE: apps/admin/src/lib/fixDeepLink.ts
 * PURPOSE: One URL shape for "open this fix", and one reader for it.
 *
 * Chrome surfaces used to link a fix four different ways (`/fixes#<id>`,
 * `/fixes?expand=<id>`, `/fixes?highlight=<id>`, plain `/fixes`) and the Fixes
 * page read none of them, so a click on a specific fix landed on the unfiltered
 * list. Links now use `fixDeepLinkPath`; the page reads every legacy form too,
 * because old Slack messages and bookmarks still carry them.
 */

const FIX_DEEP_LINK_PARAM = 'fix'

/** In-app path that opens the Attempts list with this fix expanded. */
export function fixDeepLinkPath(fixId: string): string {
  return `/fixes?tab=attempts&${FIX_DEEP_LINK_PARAM}=${encodeURIComponent(fixId)}`
}

/** In-app path that opens the Fixes list narrowed to one report's attempts. */
export function fixesForReportPath(reportId: string): string {
  return `/fixes?report=${encodeURIComponent(reportId)}`
}

const FIX_ID = /^[0-9a-f-]{8,64}$/i

/**
 * The fix id a URL asks to open, or null. Accepts `?fix=`, the legacy
 * `?expand=` / `?highlight=`, and the hash forms `#fix-<id>` / `#<id>`.
 */
export function readFixDeepLinkId(search: URLSearchParams, hash: string): string | null {
  for (const key of [FIX_DEEP_LINK_PARAM, 'expand', 'highlight']) {
    const value = search.get(key)
    if (value && FIX_ID.test(value)) return value
  }
  const fromHash = hash.replace(/^#/, '').replace(/^fix-/, '')
  return fromHash && FIX_ID.test(fromHash) ? fromHash : null
}

/** DOM id of a fix row, the scroll target for a deep link. */
export function fixRowDomId(fixId: string): string {
  return `fix-${fixId}`
}
