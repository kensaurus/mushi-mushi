/**
 * FILE: apps/admin/src/lib/authRedirect.test.ts
 * PURPOSE: Lock auth redirects for both local `/` and deployed
 *          `/mushi-mushi/admin/` basenames.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  authRedirectUrl,
  detectRecoveryFromUrl,
  loginPathForLocation,
  nextPathFromLoginState,
  sanitizeNextPath,
} from './authRedirect'

const originalUrl = typeof window !== 'undefined' ? window.location.href : null

function setLocation(href: string): void {
  // We use `history.replaceState` (no actual navigation, no reload) to
  // surgically update the URL parts of `window.location` that
  // `detectRecoveryFromUrl` reads — `pathname`, `search`, and `hash`.
  // The previous test helper used `Object.defineProperty(window,
  // 'location', { value: new URL(href) })`, which Copilot flagged as
  // fragile: jsdom's `window.location` is normally non-configurable
  // (so the call can throw `TypeError: Cannot redefine property` on
  // some runtimes), and even when it succeeds it replaces jsdom's
  // `Location` instance with a plain `URL`, breaking sibling helpers
  // like `Location.prototype.assign` and `Location.prototype.reload`
  // for any code that runs later in the same suite.
  //
  // `history.replaceState` keeps jsdom's real `Location` object intact
  // and updates `pathname`/`search`/`hash` in-place, which is exactly
  // the surface the production code under test reads.
  const u = new URL(href)
  window.history.replaceState({}, '', u.pathname + u.search + u.hash)
}

afterEach(() => {
  if (originalUrl) setLocation(originalUrl)
})

describe('auth redirect helpers', () => {
  it('preserves protected deep links through login', () => {
    expect(loginPathForLocation({ pathname: '/reports/abc', search: '?project=p1', hash: '#notes' })).toBe(
      '/login?next=%2Freports%2Fabc%3Fproject%3Dp1%23notes',
    )
  })

  it('rejects external or auth-loop next values', () => {
    expect(sanitizeNextPath('https://evil.example')).toBe('/dashboard')
    expect(sanitizeNextPath('//evil.example')).toBe('/dashboard')
    expect(sanitizeNextPath('/login?next=/reports')).toBe('/dashboard')
    expect(sanitizeNextPath('/reset-password')).toBe('/dashboard')
  })

  it('prefers React Router state over query-string next', () => {
    expect(
      nextPathFromLoginState(
        { from: { pathname: '/settings', search: '?project=p1', hash: '' } },
        '/reports',
      ),
    ).toBe('/settings?project=p1')
  })

  it('builds redirect URLs under the deployed admin basename', () => {
    expect(
      authRedirectUrl('/reset-password', {
        origin: 'https://kensaur.us',
        basePath: '/mushi-mushi/admin/',
      }),
    ).toBe('https://kensaur.us/mushi-mushi/admin/reset-password')
  })

  it('builds redirect URLs under localhost root basename', () => {
    expect(authRedirectUrl('/dashboard', { origin: 'http://localhost:6464', basePath: '/' })).toBe(
      'http://localhost:6464/dashboard',
    )
  })
})

describe('detectRecoveryFromUrl', () => {
  it('detects the legacy implicit-flow recovery hash', () => {
    setLocation(
      'https://kensaur.us/mushi-mushi/admin/reset-password#access_token=abc&refresh_token=def&type=recovery&token_type=bearer',
    )
    expect(detectRecoveryFromUrl()).toBe(true)
  })

  it('detects the PKCE-style recovery query string', () => {
    setLocation(
      'https://kensaur.us/mushi-mushi/admin/reset-password?token_hash=pkce_xyz&type=recovery',
    )
    expect(detectRecoveryFromUrl()).toBe(true)
  })

  it('returns false on a normal page with no recovery payload', () => {
    setLocation('https://kensaur.us/mushi-mushi/admin/reset-password')
    expect(detectRecoveryFromUrl()).toBe(false)
  })

  it('does not false-positive on hashes that merely contain the substring', () => {
    setLocation(
      'https://kensaur.us/mushi-mushi/admin/reset-password#some-other-anchor-with-recovery-in-name',
    )
    expect(detectRecoveryFromUrl()).toBe(false)
  })
})
