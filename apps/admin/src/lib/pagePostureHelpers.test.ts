/**
 * FILE: pagePostureHelpers.test.ts
 * PURPOSE: Unit tests for shared PagePosture chrome-dedupe helpers.
 */

import { describe, expect, it } from 'vitest'
import { shouldHideGuideWhenBannerActive, COMMON_HEALTHY_PRIORITIES, shouldHideConfigSnapshot } from './pagePostureHelpers'

describe('shouldHideGuideWhenBannerActive', () => {
  it('returns false when banner is not visible', () => {
    expect(shouldHideGuideWhenBannerActive(false, COMMON_HEALTHY_PRIORITIES, 'actions')).toBe(false)
  })

  it('hides guide when banner is visible and priority is not healthy', () => {
    expect(shouldHideGuideWhenBannerActive(true, COMMON_HEALTHY_PRIORITIES, 'actions')).toBe(true)
  })

  it('keeps guide when banner is visible but priority is healthy', () => {
    expect(shouldHideGuideWhenBannerActive(true, COMMON_HEALTHY_PRIORITIES, 'healthy')).toBe(false)
    expect(shouldHideGuideWhenBannerActive(true, COMMON_HEALTHY_PRIORITIES, 'clear')).toBe(false)
  })
})

describe('shouldHideConfigSnapshot', () => {
  it('hides when mode flag is set', () => {
    expect(shouldHideConfigSnapshot(true, false, 'healthy')).toBe(true)
  })

  it('hides for beginner when priority is not healthy', () => {
    expect(shouldHideConfigSnapshot(false, true, 'byok_failing', ['healthy'])).toBe(true)
  })

  it('shows full snapshot for advanced healthy state', () => {
    expect(shouldHideConfigSnapshot(false, false, 'healthy')).toBe(false)
  })
})
