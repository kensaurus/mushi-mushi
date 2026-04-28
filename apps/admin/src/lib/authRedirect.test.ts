/**
 * FILE: apps/admin/src/lib/authRedirect.test.ts
 * PURPOSE: Lock auth redirects for both local `/` and deployed
 *          `/mushi-mushi/admin/` basenames.
 */

import { describe, expect, it } from 'vitest'
import {
  authRedirectUrl,
  loginPathForLocation,
  nextPathFromLoginState,
  sanitizeNextPath,
} from './authRedirect'

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
