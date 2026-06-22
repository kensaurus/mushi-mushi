/**
 * FILE: connectStepLanes.test.ts
 * PURPOSE: Guardrails for shared Connect install-pipeline lane builder.
 */

import { describe, expect, it } from 'vitest'
import { buildConnectStepLanes } from './connectStepLanes'

describe('buildConnectStepLanes', () => {
  it('returns six lanes with readable short labels', () => {
    const lanes = buildConnectStepLanes({
      githubConnected: true,
      sdkConnected: true,
      mcpConnected: true,
      upgradeComplete: true,
    })
    expect(lanes).toHaveLength(6)
    expect(lanes.map((l) => l.shortLabel)).toContain('Upgrade PR')
    for (const lane of lanes) {
      expect(lane.shortLabel).not.toMatch(/…/)
    }
  })

  it('marks first incomplete lane as current', () => {
    const lanes = buildConnectStepLanes({
      githubConnected: true,
      sdkConnected: false,
      mcpConnected: false,
    })
    const current = lanes.filter((l) => l.posture === 'current')
    expect(current).toHaveLength(1)
    expect(current[0]?.shortLabel).toBe('SDK')
  })
})
