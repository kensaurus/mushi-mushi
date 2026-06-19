/**
 * Plain-language Connect hub guide (SDK, MCP, CLI, upgrades).
 */

export const CONNECT_EXPLAINER_SUMMARY =
  'Connect is the install cockpit: link GitHub, drop the SDK into your app, add MCP to Cursor, install the CLI, and open upgrade PRs when @mushi-mushi/* versions drift.'

export const CONNECT_SETUP_LANES = [
  {
    id: 'github',
    label: '1. GitHub',
    plain: 'Prerequisite for upgrade PRs, fix-worker branches, and codebase indexing.',
  },
  {
    id: 'sdk',
    label: '2. SDK',
    plain: 'Embeds the feedback widget and report ingest in your host app.',
  },
  {
    id: 'mcp',
    label: '3. MCP',
    plain: 'Lets Cursor/Claude call Mushi tools (triage, fix context) from the IDE.',
  },
  {
    id: 'cli',
    label: '4. CLI',
    plain: 'Terminal workflows — doctor, QA stories, fix merge — for power users.',
  },
  {
    id: 'upgrade',
    label: '5. Upgrade PR',
    plain: 'One-click PR that bumps @mushi-mushi/* to latest npm when versions go stale.',
  },
  {
    id: 'native_ci',
    label: '6. Native CI secrets',
    plain: 'Capacitor/RN apps must bake MUSHI_* vars at compile time — sync GitHub Actions secrets here.',
  },
] as const

export function isConnectGuideExpanded(opts: {
  githubConnected: boolean
  sdkConnected: boolean
  nativeCiNeedsAttention?: boolean
}): boolean {
  return !opts.githubConnected || !opts.sdkConnected || !!opts.nativeCiNeedsAttention
}
