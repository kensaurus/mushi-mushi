/**
 * FILE: apps/admin/src/lib/connectEditor.ts
 * PURPOSE: Whether Connect can fold its editor picker to "Connected ✓ · add
 *          another" (owner, 2026-11-18): once an editor has connected with an
 *          MCP key, the eleven-client picker is a thing you open to add a
 *          second one. Not while the editor reaches the wrong server: that is
 *          a problem, and problems stay open.
 */
export function connectedEditor(stats: {
  connectedKeyCount: number
  endpointMismatch: boolean
  lastSeenAt: string | null
}): { lastSeenAt: string | null } | null {
  if (stats.connectedKeyCount <= 0 || stats.endpointMismatch) return null
  return { lastSeenAt: stats.lastSeenAt }
}
