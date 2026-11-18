/**
 * FILE: apps/admin/src/components/query/queryTabs.ts
 * PURPOSE: SQL query's tabs, Ask first: the page exists to answer a
 *          question (console journeys 2026-10-27), so no tab in the address
 *          means Ask. The old Overview tab held only "Developer details"
 *          (round-2 review, 2026-11-18); that readout now sits under Schema,
 *          and `?tab=overview` links open Schema.
 */

import type { QueryTabId } from './types'

export const QUERY_TABS: Array<{ id: QueryTabId; label: string; description: string }> = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Ask a question about your bugs in plain words, or write SQL.',
  },
  {
    id: 'history',
    label: 'History',
    description: 'Saved pins, recent runs, and teammate queries — rerun with one click.',
  },
  {
    id: 'schema',
    label: 'Schema',
    description: 'Approved read-only tables and columns — use $1 for project_id in raw SQL.',
  },
]

function isQueryTab(value: string | null): value is QueryTabId {
  return QUERY_TABS.some((t) => t.id === value)
}

/** The tab to show for `?tab=`; Ask when absent or unknown, Schema for the retired Overview. */
export function resolveQueryTab(param: string | null): QueryTabId {
  if (param === 'overview') return 'schema'
  return isQueryTab(param) ? param : 'ask'
}

export type QueryLibraryTab = 'saved' | 'recent' | 'team'

/**
 * Which Library list opens first. It used to open on "Saved 0" and hid 25 past
 * queries (round-2 review, 2026-11-18): open where the rows are, Recent first.
 */
export function defaultLibraryTab(savedCount: number, recentCount: number): QueryLibraryTab {
  if (recentCount > 0) return 'recent'
  if (savedCount > 0) return 'saved'
  return 'recent'
}
