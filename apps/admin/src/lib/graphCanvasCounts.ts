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
  // Plain words: "47/200 nodes (newest 200 of 223) · 29/31 edges" read as
  // debug output on a page for people (2026-10-28).
  const noun = kind === 'nodes' ? 'items' : 'links'
  const head = `${shown.toLocaleString()} of ${loaded.toLocaleString()} ${noun}`
  if (typeof total === 'number' && total > loaded) {
    return `${head} (the newest ${loaded.toLocaleString()} of ${total.toLocaleString()})`
  }
  return head
}
