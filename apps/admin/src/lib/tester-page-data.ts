/**
 * FILE: apps/admin/src/lib/tester-page-data.ts
 * PURPOSE: Shared fetch options + response normalizers for the Mushi Bounties
 *          tester portal — routes are user-scoped, not project/org scoped.
 */

import type { UsePageDataOptions } from './usePageData'

/** Tester endpoints must not send X-Mushi-Project-Id / org headers. */
export const TESTER_API_OPTS: Pick<UsePageDataOptions<unknown>, 'scope'> = {
  scope: 'none',
}

export function normalizeNestedData<T>(raw: unknown): T | null {
  if (raw == null) return null
  if (typeof raw === 'object' && raw !== null && 'data' in raw) {
    return (raw as { data: T }).data ?? null
  }
  return raw as T
}

export function normalizeListItems<T>(raw: unknown): T[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw as T[]
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (Array.isArray(record.items)) return record.items as T[]
    if (record.data !== undefined) return normalizeListItems<T>(record.data)
  }
  return []
}
