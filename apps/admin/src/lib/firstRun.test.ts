import { describe, expect, it } from 'vitest'
import { isDefaultLanding, shouldOpenSetup, signupLandingPath } from './firstRun'

describe('shouldOpenSetup', () => {
  it('sends an account with no app and one team from Bugs or Home to setup', () => {
    expect(shouldOpenSetup({ pathname: '/reports', projectCount: 0, teamCount: 1 })).toBe(true)
    expect(shouldOpenSetup({ pathname: '/dashboard', projectCount: 0, teamCount: 0 })).toBe(true)
    expect(shouldOpenSetup({ pathname: '/', projectCount: 0, teamCount: 1 })).toBe(true)
  })

  it('keeps the page while counts are unknown', () => {
    expect(shouldOpenSetup({ pathname: '/reports', projectCount: null, teamCount: 1 })).toBe(false)
    expect(shouldOpenSetup({ pathname: '/reports', projectCount: 0, teamCount: null })).toBe(false)
  })

  it('keeps the page for an account with an app or another team', () => {
    expect(shouldOpenSetup({ pathname: '/reports', projectCount: 1, teamCount: 1 })).toBe(false)
    expect(shouldOpenSetup({ pathname: '/reports', projectCount: 0, teamCount: 2 })).toBe(false)
  })

  it('never redirects a deep link', () => {
    expect(shouldOpenSetup({ pathname: '/team', projectCount: 0, teamCount: 1 })).toBe(false)
    expect(shouldOpenSetup({ pathname: '/reports/abc', projectCount: 0, teamCount: 1 })).toBe(false)
  })
})

describe('signupLandingPath', () => {
  it('turns a generic landing into setup', () => {
    expect(signupLandingPath('/reports')).toBe('/onboarding')
    expect(signupLandingPath('/dashboard?project=x')).toBe('/onboarding')
    expect(signupLandingPath('/')).toBe('/onboarding')
  })

  it('keeps an invite or a deep link', () => {
    expect(signupLandingPath('/invite/abc')).toBe('/invite/abc')
    expect(signupLandingPath('/reports/123')).toBe('/reports/123')
  })

  it('ignores a trailing slash', () => {
    expect(isDefaultLanding('/reports/')).toBe(true)
  })
})
