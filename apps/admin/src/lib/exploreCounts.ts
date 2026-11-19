/**
 * FILE: apps/admin/src/lib/exploreCounts.ts
 * PURPOSE: What an Explore layer tile says. "Backend 0" did not say whether the
 *          index was read and found none or was never built (fresh-eyes
 *          2026-11-18), so a zero is only a zero once files are indexed.
 */

export interface LayerTileText {
  value: number | string
  detail: string
  /** A real count above zero (the tile may take an accent). */
  hasCount: boolean
}

export function layerTileText(count: number | null | undefined, indexedFiles: number, foundDetail: string): LayerTileText {
  if (indexedFiles <= 0) return { value: 'Not checked', detail: 'Index the repo first', hasCount: false }
  const n = count ?? 0
  if (n <= 0) {
    return {
      value: 'None found',
      detail: `in ${indexedFiles.toLocaleString()} indexed file${indexedFiles === 1 ? '' : 's'}`,
      hasCount: false,
    }
  }
  return { value: n, detail: foundDetail, hasCount: true }
}
