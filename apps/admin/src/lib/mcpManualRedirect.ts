/**
 * FILE: apps/admin/src/lib/mcpManualRedirect.ts
 * PURPOSE: Target of the legacy /mcp/manual link. "Manual" meant the
 *          copy-paste config, so it opens the Setup tab, not Summary. A `tab`
 *          already in the query wins; every other param is kept.
 *          Kept apart from mcpPageHelpers so App.tsx does not pull the MCP
 *          client registry into the first-paint bundle.
 */

export function mcpManualRedirectTarget(search: string): string {
  const params = new URLSearchParams(search)
  if (!params.has('tab')) params.set('tab', 'setup')
  return `/mcp?${params.toString()}`
}
