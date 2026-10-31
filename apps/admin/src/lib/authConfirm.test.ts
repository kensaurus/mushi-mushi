import { describe, expect, it } from 'vitest'
import { confirmErrorMessage, confirmLandingPath, readConfirmParams } from './authConfirm'

const ORIGIN = 'https://kensaur.us'
const BASE = '/mushi-mushi/admin/'

describe('readConfirmParams', () => {
  it('keeps a redirect that carries its own query', () => {
    const p = readConfirmParams('?token_hash=abc&type=email&redirect_to=https://kensaur.us/mushi-mushi/admin/invite/x?team=1&y=2')
    expect(p).toEqual({ tokenHash: 'abc', type: 'email', redirectTo: 'https://kensaur.us/mushi-mushi/admin/invite/x?team=1&y=2' })
  })

  it('defaults an unknown type to email and handles no redirect', () => {
    expect(readConfirmParams('?token_hash=abc&type=weird')).toEqual({ tokenHash: 'abc', type: 'email', redirectTo: null })
  })
})

describe('confirmLandingPath', () => {
  it('opens setup for a generic landing', () => {
    expect(confirmLandingPath('https://kensaur.us/mushi-mushi/admin/reports', ORIGIN, BASE)).toBe('/onboarding')
    expect(confirmLandingPath(null, ORIGIN, BASE)).toBe('/onboarding')
  })

  it('keeps an invite inside the console', () => {
    expect(confirmLandingPath('https://kensaur.us/mushi-mushi/admin/invite/abc', ORIGIN, BASE)).toBe('/invite/abc')
  })

  it('never leaves the console', () => {
    expect(confirmLandingPath('https://evil.example/phish', ORIGIN, BASE)).toBe('/onboarding')
    expect(confirmLandingPath('//evil.example/x', ORIGIN, BASE)).toBe('/onboarding')
    expect(confirmLandingPath('javascript:alert(1)', ORIGIN, BASE)).toBe('/onboarding')
  })
})

describe('confirmErrorMessage', () => {
  it('explains an expired or reused link', () => {
    expect(confirmErrorMessage('Email link is invalid or has expired')).toContain('expired or was already used')
  })
})
