import { describe, expect, it } from 'vitest'
import {
  connectLaneOverlay,
  fixesStageOverlay,
  inboxStageOverlay,
} from './guideLiveOverlay'

describe('guideLiveOverlay', () => {
  it('inbox open plan stage', () => {
    const overlay = inboxStageOverlay('plan', {
      openPlan: true,
      openDo: false,
      openCheck: false,
      openAct: false,
      openOps: false,
    })
    expect(overlay.posture).toBe('open')
    expect(overlay.metric).toBe('Open')
  })

  it('connect mcp lane not done when sdk connected', () => {
    const overlay = connectLaneOverlay('mcp', {
      githubConnected: true,
      sdkConnected: true,
      mcpConnected: false,
    })
    expect(overlay.metric).toBe('Not set up')
    expect(overlay.posture).toBe('open')
  })

  it('fixes dispatch shows failed count', () => {
    const overlay = fixesStageOverlay('dispatch', {
      failed: 2,
      inProgress: 0,
      prsOpen: 0,
      prsCiPassing: 0,
      topPriority: 'failed',
      topPriorityLabel: 'Retry failed fixes',
      topPriorityTo: '/fixes',
    })
    expect(overlay.metric).toBe('2 failed')
    expect(overlay.posture).toBe('danger')
  })
})
