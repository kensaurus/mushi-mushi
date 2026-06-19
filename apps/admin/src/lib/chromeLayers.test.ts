import { describe, expect, it } from 'vitest'
import {
  shouldDefaultCollapsePipelineRibbon,
  shouldShowDavCoachmark,
  shouldShowLayoutPageHero,
} from './chromeLayers'

describe('chromeLayers', () => {
  it('skips layout PageHero on loop hubs and page-owned routes', () => {
    expect(shouldShowLayoutPageHero('/dashboard')).toBe(false)
    expect(shouldShowLayoutPageHero('/inbox')).toBe(false)
    expect(shouldShowLayoutPageHero('/reports')).toBe(false)
    expect(shouldShowLayoutPageHero('/health')).toBe(false)
  })

  it('shows layout PageHero on routes without page-owned loop chrome', () => {
    expect(shouldShowLayoutPageHero('/billing')).toBe(true)
    expect(shouldShowLayoutPageHero('/settings')).toBe(true)
  })

  it('defaults pipeline ribbon collapsed on dashboard only', () => {
    expect(shouldDefaultCollapsePipelineRibbon('/dashboard')).toBe(true)
    expect(shouldDefaultCollapsePipelineRibbon('/inbox')).toBe(false)
    expect(shouldDefaultCollapsePipelineRibbon('/reports')).toBe(false)
  })

  it('hides DAV coachmark on dashboard', () => {
    expect(shouldShowDavCoachmark('/dashboard')).toBe(false)
    expect(shouldShowDavCoachmark('/projects')).toBe(true)
    expect(shouldShowDavCoachmark('/inbox')).toBe(true)
  })
})
