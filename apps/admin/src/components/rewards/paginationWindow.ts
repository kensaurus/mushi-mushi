/**
 * FILE: apps/admin/src/components/rewards/paginationWindow.ts
 * PURPOSE: Which page buttons the contributor leaderboard shows.
 *
 *   The old inline formula (`page - 2 + i`) produced -1/0 duplicates near the
 *   first page ("1 1 2 3 4 N", duplicate React keys) and repeated the last
 *   page near the end. This returns unique, ascending, 0-based page indexes.
 */

/**
 * Up to `max` page indexes: always the first and last page, plus a window
 * centred on `page` that slides inward at either end.
 */
export function paginationWindow(page: number, totalPages: number, max = 7): number[] {
  if (totalPages <= 0) return []
  if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i)
  const current = Math.min(Math.max(page, 0), totalPages - 1)
  const inner = max - 2 // slots between first and last
  let start = current - Math.floor(inner / 2)
  start = Math.max(1, Math.min(start, totalPages - 1 - inner))
  const pages = [0]
  for (let p = start; p < start + inner; p += 1) pages.push(p)
  pages.push(totalPages - 1)
  return pages
}
