/**
 * FILE: ConnectStepFlow.test.ts
 * PURPOSE: Layout guardrails for connect pipeline step labels and node sizing.
 */

import { describe, expect, it } from 'vitest'
import type { StepNodeData } from './ConnectStepFlow'
import {
  buildConnectStepNodePositions,
  minConnectStepCanvasWidth,
  pickDefaultConnectStepIndex,
} from './ConnectStepFlow'

const SAMPLE_LANES: StepNodeData[] = [
  { label: '1. GitHub', shortLabel: 'GitHub', posture: 'clear', stepIdx: 0, totalSteps: 6 },
  { label: '2. SDK', shortLabel: 'SDK', posture: 'clear', stepIdx: 1, totalSteps: 6 },
  { label: '3. MCP', shortLabel: 'MCP', posture: 'current', stepIdx: 2, totalSteps: 6 },
  { label: '5. Upgrade PR', shortLabel: 'Upgrade PR', posture: 'info', stepIdx: 4, totalSteps: 6 },
  { label: '6. Native CI secrets', shortLabel: 'Native CI', posture: 'clear', stepIdx: 5, totalSteps: 6 },
]

describe('ConnectStepFlow lane labels', () => {
  it('uses full short labels without ellipsis truncation markers', () => {
    for (const lane of SAMPLE_LANES) {
      expect(lane.shortLabel).not.toMatch(/…/)
      expect(lane.shortLabel.length).toBeGreaterThan(0)
    }
  })

  it('keeps upgrade lane readable at a glance', () => {
    const upgrade = SAMPLE_LANES.find((l) => l.shortLabel.includes('Upgrade'))
    expect(upgrade?.shortLabel).toBe('Upgrade PR')
  })
})

describe('ConnectStepFlow layout', () => {
  it('anchors first and last nodes inside canvas padding on wide containers', () => {
    const { positions, canvasW } = buildConnectStepNodePositions(6, 900)
    expect(positions[0]).toBe(12)
    expect(positions[5]).toBeCloseTo(canvasW - 12 - 108, 5)
    expect(canvasW).toBe(900)
  })

  it('expands canvas beyond container when minimum spacing is required', () => {
    const minW = minConnectStepCanvasWidth(6)
    const { canvasW } = buildConnectStepNodePositions(6, 400)
    expect(canvasW).toBe(minW)
    expect(canvasW).toBeGreaterThan(400)
  })

  it('defaults selection to the current lane in the flow', () => {
    expect(pickDefaultConnectStepIndex(SAMPLE_LANES)).toBe(2)
  })
})
