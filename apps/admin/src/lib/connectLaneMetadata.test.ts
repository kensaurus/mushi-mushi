/**
 * FILE: connectLaneMetadata.test.ts
 * PURPOSE: Live metadata on Connect pipeline nodes (versions, repo, MCP keys).
 */

import { describe, expect, it } from 'vitest'
import { attachConnectLaneMetadata } from './connectLaneMetadata'
import { buildConnectStepLanes } from './connectStepLanes'

describe('connectLaneMetadata', () => {
  it('shows version drift on upgrade node', () => {
    const lanes = buildConnectStepLanes({
      githubConnected: true,
      sdkConnected: true,
      mcpConnected: true,
      sdkVersion: '0.19.0',
      sdkLatestVersion: '0.19.2',
      sdkStatus: 'outdated',
      upgradeComplete: false,
    })
    const upgrade = lanes.find((l) => l.laneId === 'upgrade')
    expect(upgrade?.metaLine).toBe('0.19.0 → 0.19.2')
    expect(upgrade?.metaTone).toBe('warn')
    expect(upgrade?.facts?.find((f) => f.label === 'Latest')?.value).toBe('v0.19.2')
  })

  it('shows repo slug on github node', () => {
    const lanes = attachConnectLaneMetadata(
      buildConnectStepLanes({ githubConnected: true, sdkConnected: false }),
      {
        githubConnected: true,
        sdkConnected: false,
        githubRepoUrl: 'https://github.com/kensaurus/yen-yen',
      },
    )
    const github = lanes.find((l) => l.laneId === 'github')
    expect(github?.metaLine).toBe('kensaurus/yen-yen')
  })

  it('shows installed SDK version on sdk node', () => {
    const lanes = buildConnectStepLanes({
      githubConnected: true,
      sdkConnected: true,
      sdkVersion: '1.20.0',
      sdkLatestVersion: '1.20.0',
    })
    const sdk = lanes.find((l) => l.laneId === 'sdk')
    expect(sdk?.metaLine).toBe('v1.20.0')
  })
})
