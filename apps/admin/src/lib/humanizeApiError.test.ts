/**
 * FILE: apps/admin/src/lib/humanizeApiError.test.ts
 * PURPOSE: Unit tests for page-load error humanization.
 */

import { describe, expect, it } from 'vitest'
import { humanizeApiError, parsePageDataError } from './humanizeApiError'

describe('parsePageDataError', () => {
  it('extracts code from usePageData format', () => {
    expect(parsePageDataError('X-Mushi-Org-Id header required (NO_ORG)')).toEqual({
      message: 'X-Mushi-Org-Id header required',
      code: 'NO_ORG',
    })
  })

  it('returns plain message when no code', () => {
    expect(parsePageDataError('Request failed')).toEqual({ message: 'Request failed' })
  })
})

describe('humanizeApiError', () => {
  it('maps NO_ORG to a team-switch hint', () => {
    const h = humanizeApiError('X-Mushi-Org-Id header required (NO_ORG)')
    expect(h?.code).toBe('NO_ORG')
    expect(h?.title).toMatch(/team/i)
    expect(h?.action?.target).toMatchObject({ kind: 'route' })
  })

  it('maps NETWORK_ERROR to soft retry', () => {
    const h = humanizeApiError('Failed to fetch', 'NETWORK_ERROR')
    expect(h?.severity).toBe('soft')
    expect(h?.action?.target).toEqual({ kind: 'retry' })
  })

  it('falls back helpfully for unknown codes', () => {
    const h = humanizeApiError('Something odd (WEIRD_CODE)')
    expect(h?.title).toBeTruthy()
    expect(h?.hint.length).toBeGreaterThan(10)
  })
})

describe('humanizeApiError: invitation accept (QA #68)', () => {
  it('never shows the raw RPC text as the headline', () => {
    for (const [message, code] of [
      ['invitation_email_mismatch', 'EMAIL_MISMATCH'],
      ['invitation_invalid_or_expired', 'EXPIRED_OR_REVOKED'],
      ['some postgres error', 'INVITE_ACCEPT_FAILED'],
    ] as const) {
      const h = humanizeApiError(message, code)
      expect(h?.title).not.toContain(message)
      expect(h?.hint).not.toContain(message)
    }
  })

  it('tells an invitee with the wrong account what to do', () => {
    expect(humanizeApiError('invitation_email_mismatch', 'EMAIL_MISMATCH')?.hint).toMatch(/sign in with the email/i)
    expect(humanizeApiError('invitation_invalid_or_expired', 'EXPIRED_OR_REVOKED')?.hint).toMatch(/new invite/i)
  })
})
