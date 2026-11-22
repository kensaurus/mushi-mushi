/**
 * FILE: apps/admin/src/lib/homeConnectHref.ts
 * PURPOSE: Where a Home "connect" button really goes. The server's hint for
 *          the live-site watch points at /credits (Spend credits), which
 *          only lists watches that already exist beside the Firecrawl
 *          balance. Turning one on, with its address and page limit, is the
 *          "Watch your live site" card on the app map's Discovery tab
 *          (re-audit 2026-11-11). Until the server hint changes, the console
 *          sends that one button to the card.
 */

/** The id on SiteWatchCard, so the link lands on it. */
export const SITE_WATCH_ANCHOR = 'site-watch'

const SITE_WATCH_HREF = `/inventory?tab=discovery#${SITE_WATCH_ANCHOR}`

/** The server's label for the site-watch hint (`SITE_WATCH_CONNECT` in _shared/project-home.ts). */
const SITE_WATCH_LABEL = /live-site watch/i

export function homeConnectHref(connect: { label: string; to: string }): string {
  if (connect.to === '/credits' && SITE_WATCH_LABEL.test(connect.label)) return SITE_WATCH_HREF
  return connect.to
}
