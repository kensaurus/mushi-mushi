/**
 * FILE: apps/admin/src/components/query/queryTabs.ts
 * PURPOSE: SQL query's tabs, Ask first: the page exists to answer a
 *          question (console journeys 2026-10-27), so no tab in the address
 *          means Ask, and the old Overview is the last tab.
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
  {
    id: 'overview',
    label: 'Overview',
    description: 'How your recent questions ran: counts, errors and speed.',
  },
]

function isQueryTab(value: string | null): value is QueryTabId {
  return QUERY_TABS.some((t) => t.id === value)
}

/** The tab to show for `?tab=`; Ask when absent or unknown. */
export function resolveQueryTab(param: string | null): QueryTabId {
  return isQueryTab(param) ? param : 'ask'
}
