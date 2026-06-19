import { describe, expect, it } from 'vitest'
import { shouldShowPipelineRibbon } from './pipelineRibbonVisibility'

describe('shouldShowPipelineRibbon', () => {
  it('shows on PDCA cockpit and loop hubs', () => {
    expect(shouldShowPipelineRibbon('/dashboard')).toBe(true)
    expect(shouldShowPipelineRibbon('/reports')).toBe(true)
    expect(shouldShowPipelineRibbon('/fixes')).toBe(true)
  })

  it('hides on workspace and config surfaces', () => {
    expect(shouldShowPipelineRibbon('/projects')).toBe(false)
    expect(shouldShowPipelineRibbon('/settings')).toBe(false)
    expect(shouldShowPipelineRibbon('/billing')).toBe(false)
    expect(shouldShowPipelineRibbon('/health')).toBe(false)
  })
})
