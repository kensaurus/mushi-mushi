/**
 * FILE: apps/admin/src/lib/integrationAnchors.ts
 * PURPOSE: Integrations is a grid of tiles now; each tool's settings open in a
 *          drawer (owner, 2026-11-18). About forty links across the console
 *          still point at the old card anchors (`/integrations/config#platform-card-github`,
 *          `#integrations-codebase`, `#integrations-linear`, …). This maps an
 *          anchor to the tool whose drawer holds it, so those links open the
 *          right drawer instead of landing on nothing.
 *
 *          Anchors that are still sections of the page itself (`#alerts`,
 *          `#integrations-routing`) map to null: the page scrolls to them.
 */

/** Tool ids, the same as the grid's tiles (components/integrations/connectionGridModel.ts). */
type IntegrationToolId =
  | 'sentry'
  | 'github'
  | 'slack'
  | 'discord'
  | 'teams'
  | 'langfuse'
  | 'cursor_cloud'
  | 'claude_code_agent'
  | 'linear'
  | 'jira'
  | 'github_issues'
  | 'pagerduty'

const ANCHOR_TOOL: Record<string, IntegrationToolId> = {
  // GitHub's one home: Connect GitHub, the token fallback and code indexing.
  'platform-card-github': 'github',
  'platform-card-github-token': 'github',
  'connect-github': 'github',
  'integrations-required': 'github',
  'integrations-codebase': 'github',
  'platform-card-sentry': 'sentry',
  'integrations-monitoring': 'sentry',
  'platform-card-langfuse': 'langfuse',
  'integrations-advanced': 'langfuse',
  'platform-card-cursor_cloud': 'cursor_cloud',
  'integrations-fix-agent': 'cursor_cloud',
  'platform-card-claude_code_agent': 'claude_code_agent',
  'integrations-slack': 'slack',
  'integrations-discord': 'discord',
  'integrations-teams': 'teams',
  'integrations-linear': 'linear',
  'integrations-jira': 'jira',
  'integrations-github_issues': 'github_issues',
  'integrations-pagerduty': 'pagerduty',
}

/** The tool whose drawer a `#hash` (with or without the `#`) points into, else null. */
export function integrationToolForHash(hash: string | null | undefined): IntegrationToolId | null {
  if (!hash) return null
  let id = hash.startsWith('#') ? hash.slice(1) : hash
  try {
    id = decodeURIComponent(id)
  } catch {
    return null
  }
  return Object.prototype.hasOwnProperty.call(ANCHOR_TOOL, id) ? ANCHOR_TOOL[id]! : null
}
