/**
 * FILE: apps/admin/src/lib/inventoryReadout.ts
 * PURPOSE: Which /inventory tabs need gate findings loaded. The Drift tab
 *          builds its three columns from crawler findings; it used to be
 *          missing here, so the columns never refreshed after a reconcile.
 */

const FINDINGS_TABS = new Set(['stories', 'gates', 'drift'])

export function inventoryFindingsEnabled(tab: string): boolean {
  return FINDINGS_TABS.has(tab)
}
