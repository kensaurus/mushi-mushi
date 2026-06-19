/**
 * Plain-language MCP setup guide for the admin console.
 */

export interface McpScopeDefinition {
  id: 'read' | 'write'
  label: string
  plain: string
  canDo: string[]
  cannotDo: string[]
}

export const MCP_SCOPE_DEFINITIONS: McpScopeDefinition[] = [
  {
    id: 'read',
    label: 'mcp:read',
    plain: 'Browse reports, fixes, QA runs, and codebase context from your IDE agent.',
    canDo: [
      'List and inspect reports, fixes, and pipeline status',
      'Search the codebase and fetch fix context for a bug',
      'Read-only — safe for daily agent use',
    ],
    cannotDo: ['Dispatch fixes, merge PRs, or start skill pipelines'],
  },
  {
    id: 'write',
    label: 'mcp:write',
    plain: 'Everything in mcp:read plus actions that change state.',
    canDo: [
      'Dispatch fix attempts and refresh CI on a PR',
      'Start skill pipelines and check in pipeline steps',
      'Send test notifications',
    ],
    cannotDo: ['Change billing, org settings, or delete projects'],
  },
]

export const MCP_EXPLAINER_SUMMARY =
  'MCP (Model Context Protocol) lets Cursor, Claude Code, or other agents call Mushi tools directly — triage bugs, fetch fix context, and dispatch fixes without leaving the IDE. You need an mcp:read or mcp:write API key and a .cursor/mcp.json snippet.'

export const MCP_SETUP_STEPS = [
  'Mint an mcp:read key on Projects (or mcp:write if the agent should dispatch fixes).',
  'Copy the MCP snippet from this page into .cursor/mcp.json in your repo.',
  'Restart the IDE, then ask the agent: "list mushi tools".',
  'A green Connected chip means the key heartbeat reached this backend.',
]

export function isMcpGuideExpanded(topPriority: string | undefined): boolean {
  return (
    topPriority === 'no_mcp_key' ||
    topPriority === 'never_connected' ||
    topPriority === 'endpoint_mismatch' ||
    topPriority === 'report_only_keys' ||
    topPriority === 'no_project'
  )
}
