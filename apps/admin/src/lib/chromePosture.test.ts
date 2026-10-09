import { describe, expect, it } from 'vitest'
import {
  postureStripsAreMutuallyExclusive,
  shouldShowPipelineRibbonChrome,
} from './chromePosture'

describe('chromePosture', () => {
  it('pipeline ribbon only in advanced on hub routes', () => {
    expect(shouldShowPipelineRibbonChrome(true, '/dashboard')).toBe(true)
    expect(shouldShowPipelineRibbonChrome(true, '/settings')).toBe(false)
    expect(shouldShowPipelineRibbonChrome(false, '/dashboard')).toBe(false)
  })

  it('posture strips never co-render (mode invariant)', () => {
    expect(postureStripsAreMutuallyExclusive(true, false)).toBe(true)
    expect(postureStripsAreMutuallyExclusive(false, true)).toBe(true)
    expect(postureStripsAreMutuallyExclusive(true, true)).toBe(false)
  })
})
