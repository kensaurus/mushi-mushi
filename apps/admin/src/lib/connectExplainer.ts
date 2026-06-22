/**
 * Plain-language Connect hub guide (SDK, MCP, CLI, upgrades).
 */

export const CONNECT_SETUP_LANES = [
  {
    id: 'github',
    label: '1. GitHub',
    plain: 'Link the repo where your app lives.',
  },
  {
    id: 'sdk',
    label: '2. SDK',
    plain: 'Add the snippet so users can send bug reports from your app.',
  },
  {
    id: 'mcp',
    label: '3. MCP',
    plain: 'Let Cursor or VS Code reach Mushi while you code.',
  },
  {
    id: 'cli',
    label: '4. CLI',
    plain: 'Optional — run doctor, QA, and merge commands in your terminal.',
  },
  {
    id: 'upgrade',
    label: '5. Upgrade PR',
    plain: 'Open a PR when @mushi-mushi packages fall behind npm.',
  },
  {
    id: 'native_ci',
    label: '6. Native CI secrets',
    plain: 'Mobile apps need MUSHI_* vars in GitHub Actions before they build.',
  },
] as const

export function isConnectGuideExpanded(opts: {
  githubConnected: boolean
  sdkConnected: boolean
  nativeCiNeedsAttention?: boolean
}): boolean {
  return !opts.githubConnected || !opts.sdkConnected || !!opts.nativeCiNeedsAttention
}
