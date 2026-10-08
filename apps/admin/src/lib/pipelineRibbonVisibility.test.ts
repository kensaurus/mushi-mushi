import { describe, expect, it } from 'vitest'
import { shouldShowPipelineRibbon } from './pipelineRibbonVisibility'

describe('shouldShowPipelineRibbon', () => {
  it('shows on the two hubs', () => {
    expect(shouldShowPipelineRibbon('/dashboard')).toBe(true)
    expect(shouldShowPipelineRibbon('/inbox')).toBe(true)
  })

  it('hides on a single stage page, where the sidebar badges already say it', () => {
    expect(shouldShowPipelineRibbon('/reports')).toBe(false)
    expect(shouldShowPipelineRibbon('/fixes')).toBe(false)
    expect(shouldShowPipelineRibbon('/repo')).toBe(false)
  })

  it('hides on workspace and config surfaces', () => {
    expect(shouldShowPipelineRibbon('/projects')).toBe(false)
    expect(shouldShowPipelineRibbon('/settings')).toBe(false)
    expect(shouldShowPipelineRibbon('/billing')).toBe(false)
    expect(shouldShowPipelineRibbon('/health')).toBe(false)
  })
})
