/**
 * FILE: apps/admin/src/lib/vizTokenReadTiming.test.ts
 * PURPOSE: Colour maps built from viz tokens read the stylesheet when used,
 *          not when their module loads. main.tsx imports App before
 *          index.css, so a module-load read sees no tokens and keeps the
 *          unstyled grey for the whole session.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { HERO_ACTION_TONE_HEX, HERO_SEVERITY_HEX } from '../components/hero-flow/heroFlow.data'
import { STAGE_HEX, TONE_HEX } from '../components/flow-primitives/flowTokens'
import { buildPipelineEdges, type PipelineStep } from '../components/skill-pipeline/pipelineFlow.data'
import { debugLog } from './debug'

const STYLED: Record<string, string> = {
  'viz-neutral': 'oklch(0.65 0.02 285)',
  'viz-score-ok': 'oklch(0.72 0.19 155)',
  'viz-flow-info': 'oklch(0.68 0.15 250)',
  'viz-flow-danger': 'oklch(0.63 0.22 25)',
  'viz-step-running': 'oklch(0.68 0.15 250)',
  'viz-step-passed': 'oklch(0.72 0.17 160)',
  accent: 'oklch(0.7 0.1 80)',
}

function applyStylesheet() {
  for (const [name, value] of Object.entries(STYLED)) {
    document.documentElement.style.setProperty(`--color-${name}`, value)
  }
}

describe('viz colour maps read tokens on use', () => {
  afterEach(() => {
    for (const name of Object.keys(STYLED)) {
      document.documentElement.style.removeProperty(`--color-${name}`)
    }
    localStorage.removeItem('mushi:debug')
    vi.restoreAllMocks()
  })

  it('hero flow maps pick up tokens set after import', () => {
    applyStylesheet()
    expect(HERO_SEVERITY_HEX.neutral).toBe(STYLED['viz-neutral'])
    expect(HERO_SEVERITY_HEX.crit).toBe(STYLED['viz-flow-danger'])
    expect(HERO_ACTION_TONE_HEX.idle).toBe(STYLED['viz-neutral'])
    expect(HERO_ACTION_TONE_HEX.plan).toBe(STYLED['viz-flow-info'])
  })

  it('PDCA stage and tone maps pick up tokens set after import', () => {
    applyStylesheet()
    expect(STAGE_HEX.plan).toBe(STYLED['viz-flow-info'])
    expect(STAGE_HEX.act).toBe(STYLED['viz-score-ok'])
    expect(TONE_HEX.urgent).toBe(STYLED['viz-flow-danger'])
  })

  it('pipeline edges pick up step tokens set after import', () => {
    applyStylesheet()
    const steps = [
      { step_index: 0, skill_slug: 'a', status: 'running' },
      { step_index: 1, skill_slug: 'b', status: 'passed' },
    ] as PipelineStep[]
    const [edge] = buildPipelineEdges(steps)
    expect(edge?.data?.sourceColor).toBe(STYLED['viz-step-running'])
    expect(edge?.data?.targetColor).toBe(STYLED['viz-step-passed'])
  })

  it('debug log prefix picks up the accent set after import', () => {
    applyStylesheet()
    localStorage.setItem('mushi:debug', 'true')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    debugLog('viz', 'probe')
    expect(String(log.mock.calls[0]?.[1])).toContain(STYLED.accent)
  })
})
