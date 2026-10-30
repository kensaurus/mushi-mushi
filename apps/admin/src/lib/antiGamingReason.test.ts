/**
 * FILE: apps/admin/src/lib/antiGamingReason.test.ts
 * PURPOSE: The token chip and the multi-account sentence show one count.
 */

import { describe, expect, it } from 'vitest'

import { flagReasonForTokenCount } from './antiGamingReason'

const SCRIPTED =
  'Multi-account: 4 reporter tokens from one scripted client (node). A server sending reports for many users looks like this.'

describe('flagReasonForTokenCount', () => {
  it('puts the live token count into a multi-account sentence', () => {
    expect(flagReasonForTokenCount(SCRIPTED, 16)).toBe(
      'Multi-account: 16 reporter tokens from one scripted client (node). A server sending reports for many users looks like this.',
    )
    expect(flagReasonForTokenCount('Multi-account: 4 reporter tokens from same device', 6)).toBe(
      'Multi-account: 6 reporter tokens from same device',
    )
  })

  it('leaves manual and velocity reasons alone', () => {
    expect(flagReasonForTokenCount('Suspicious activity confirmed', 9)).toBe('Suspicious activity confirmed')
    expect(flagReasonForTokenCount('Velocity anomaly: 12 reports in 24h', 9)).toBe(
      'Velocity anomaly: 12 reports in 24h',
    )
    expect(flagReasonForTokenCount(null, 4)).toBeNull()
  })
})
