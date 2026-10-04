/**
 * FILE: apps/admin/src/lib/quickTab.ts
 * PURPOSE: When Quick mode may choose a page's starting tab (Billing,
 *          Notifications; suspected-bugs entry 116).
 *
 * It picks once per visit, after the page's stats have loaded, and only when
 * the link did not name a tab: an explicit `?tab=` (a "View plans" button, a
 * bookmark) wins, and a tab the user opens afterwards stays open. It used to
 * re-pick on every render, so ?tab=support and ?tab=outbox bounced back.
 */

export function shouldPickQuickTab(input: {
  isQuickstart: boolean
  statsReady: boolean
  tabParam: string | null
  alreadyPicked: boolean
}): boolean {
  return input.isQuickstart && input.statsReady && input.tabParam === null && !input.alreadyPicked
}
