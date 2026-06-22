/**
 * FILE: connectLaneReadout.test.ts
 * PURPOSE: Guardrails for non-duplicative Connect lane readout copy.
 */

import { describe, expect, it } from 'vitest'
import type { StepNodeData } from '../components/connect/ConnectStepFlow'
import { buildConnectLaneReadout, pickConnectLaneBody } from './connectLaneReadout'

describe('connectLaneReadout', () => {
  it('uses one sentence for optional CLI — not actionLine stacked on plain', () => {
    const lane: StepNodeData = {
      label: '4. CLI',
      shortLabel: 'CLI',
      laneId: 'cli',
      posture: 'current',
      overlayPosture: 'info',
      metric: 'Optional',
      plain: 'Optional — run doctor, QA, and merge commands in your terminal.',
      stepIdx: 3,
      totalSteps: 6,
    }
    const body = pickConnectLaneBody(lane, 'info')
    expect(body).not.toMatch(/terminal.*terminal/i)
    expect(body.split('.').filter(Boolean).length).toBeLessThanOrEqual(2)
  })

  it('shows a short done blurb instead of repeating plain text', () => {
    const lane: StepNodeData = {
      label: '1. GitHub',
      shortLabel: 'GitHub',
      laneId: 'github',
      posture: 'clear',
      overlayPosture: 'clear',
      metric: 'Linked',
      plain: 'Link the repo where your app lives.',
      stepIdx: 0,
      totalSteps: 6,
    }
    const model = buildConnectLaneReadout(lane)
    expect(model.body).toBe('Your repo is linked and ready for upgrade PRs.')
    expect(model.body).not.toBe(lane.plain)
  })

  it('prefers actionLine over plain when step is incomplete', () => {
    const lane: StepNodeData = {
      label: '2. SDK',
      shortLabel: 'SDK',
      laneId: 'sdk',
      posture: 'current',
      overlayPosture: 'open',
      metric: 'Not installed',
      actionLine: 'Copy the SDK snippet into your app.',
      plain: 'Add the snippet so users can send bug reports from your app.',
      stepIdx: 1,
      totalSteps: 6,
    }
    expect(pickConnectLaneBody(lane, 'open')).toBe('Copy the SDK snippet into your app.')
  })
})
