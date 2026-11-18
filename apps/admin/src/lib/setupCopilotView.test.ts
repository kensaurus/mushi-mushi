import { describe, expect, it } from 'vitest'
import { sdkHeardFrom, setupCopilotRedirectTarget } from './setupCopilotView'

describe('setupCopilotRedirectTarget', () => {
  it('opens Set up on Overview, not on "Fix a problem"', () => {
    expect(setupCopilotRedirectTarget('')).toBe('/onboarding')
  })

  it('keeps the project and any tab the link names', () => {
    expect(setupCopilotRedirectTarget('?project=p1')).toBe('/onboarding?project=p1')
    expect(setupCopilotRedirectTarget('?project=p1&tab=diagnose')).toBe('/onboarding?project=p1&tab=diagnose')
  })
})

describe('sdkHeardFrom', () => {
  it('needs an active key that has checked in', () => {
    expect(sdkHeardFrom(undefined)).toBe(false)
    expect(sdkHeardFrom([{ is_active: false, last_seen_at: '2026-11-18T00:00:00Z' }])).toBe(false)
    expect(sdkHeardFrom([{ is_active: true, last_seen_at: null }])).toBe(false)
    expect(sdkHeardFrom([{ is_active: true, last_seen_at: '2026-11-18T00:00:00Z' }])).toBe(true)
  })
})
