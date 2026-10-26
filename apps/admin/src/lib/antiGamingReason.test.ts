import { describe, expect, it } from 'vitest'

import { eventTokenChipText, flagReasonForTokenCount } from './antiGamingReason'

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

describe('eventTokenChipText', () => {
  it('does not put a second token count next to a multi-account sentence', () => {
    expect(eventTokenChipText(['rk1_aaaaaaaa', 'rk1_bbbbbbbb'], SCRIPTED)).toBe('tok:aaaaaaaa…')
  })

  it('still counts keys when the reason is not a multi-account sentence', () => {
    expect(eventTokenChipText(['rk1_aaaaaaaa', 'rk1_bbbbbbbb'], 'Velocity anomaly: 12 reports in 24h')).toBe(
      '2 tokens',
    )
    expect(eventTokenChipText(['rk1_aaaaaaaa'], SCRIPTED)).toBe('tok:aaaaaaaa…')
  })
})
