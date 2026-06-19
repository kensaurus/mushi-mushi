import { describe, expect, it } from 'vitest'
import {
  postureStripsAreMutuallyExclusive,
  shouldShowNextBestActionChrome,
  shouldShowPipelineRibbonChrome,
} from './chromePosture'

describe('chromePosture', () => {
  it('NBA chrome only in beginner mode on protected routes', () => {
    expect(shouldShowNextBestActionChrome(true, '/dashboard')).toBe(true)
    expect(shouldShowNextBestActionChrome(false, '/dashboard')).toBe(false)
    expect(shouldShowNextBestActionChrome(true, '/login')).toBe(false)
  })

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
