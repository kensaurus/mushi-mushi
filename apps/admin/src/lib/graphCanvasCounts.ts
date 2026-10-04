/**
 * FILE: apps/admin/src/lib/graphCanvasCounts.ts
 * PURPOSE: The /graph canvas proof line. The canvas loads at most 200 nodes
 *          and 500 edges (newest first) while the header stat is the exact
 *          total, so the line has to say when it is showing a slice instead
 *          of implying the slice is everything.
 */

export function graphCanvasProof(
  kind: 'nodes' | 'edges',
  shown: number,
  loaded: number,
  total: number | null | undefined,
): string {
  const head = `${shown}/${loaded} ${kind}`
  if (typeof total === 'number' && total > loaded) {
    return `${head} (newest ${loaded.toLocaleString()} of ${total.toLocaleString()})`
  }
  return head
}
