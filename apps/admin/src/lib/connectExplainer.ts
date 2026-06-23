/**
 * Plain-language Connect hub guide (SDK, MCP, CLI, upgrades).
 */

export const CONNECT_SETUP_LANES = [
  {
    id: 'github',
    label: 'GitHub',
    plain: 'Link the repo where your app lives.',
  },
  {
    id: 'sdk',
    label: 'SDK',
    plain: 'Add the snippet so users can send bug reports from your app.',
  },
  {
    id: 'mcp',
    label: 'MCP',
    plain: 'Let Cursor or VS Code reach Mushi while you code.',
  },
  {
    id: 'cli',
    label: 'CLI',
    plain: 'Optional — run doctor, QA, and merge commands in your terminal.',
  },
  {
    id: 'upgrade',
    label: 'Upgrade PR',
    plain: 'Open a PR when @mushi-mushi packages fall behind npm.',
  },
  {
    id: 'native_ci',
    label: 'Native CI secrets',
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
