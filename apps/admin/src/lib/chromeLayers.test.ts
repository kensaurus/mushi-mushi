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

  it('skips layout PageHero when page posture status banner is active', () => {
    expect(shouldShowLayoutPageHero('/billing', true)).toBe(false)
    expect(shouldShowLayoutPageHero('/settings', true)).toBe(false)
  })

  it('defaults pipeline ribbon collapsed on dashboard only', () => {
    expect(shouldDefaultCollapsePipelineRibbon('/dashboard')).toBe(true)
    expect(shouldDefaultCollapsePipelineRibbon('/inbox')).toBe(false)
    expect(shouldDefaultCollapsePipelineRibbon('/reports')).toBe(false)
  })

  it('hides DAV coachmark on dashboard', () => {
    expect(shouldShowDavCoachmark('/dashboard')).toBe(false)
    expect(shouldShowDavCoachmark('/inbox')).toBe(true)
  })

  it('hides DAV coachmark where no pipeline ribbon renders', () => {
    // These routes own a hero but carry no workspace pipeline strip, so the
    // "Two strips, two jobs" copy would describe something that isn't there.
    expect(shouldShowDavCoachmark('/onboarding')).toBe(false)
    expect(shouldShowDavCoachmark('/feedback')).toBe(false)
    expect(shouldShowDavCoachmark('/feature-board')).toBe(false)
    expect(shouldShowDavCoachmark('/projects')).toBe(false)
    expect(shouldShowDavCoachmark('/inbox', false)).toBe(false)
  })
})
