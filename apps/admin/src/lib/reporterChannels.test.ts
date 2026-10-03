import { describe, expect, it } from 'vitest'
import { deliveryLabel, deliveryNeedsAttention, templateProblem, templatesPayload } from './reporterChannels'

describe('reporterChannels', () => {
  it('explains why an email did not go out, in plain words', () => {
    expect(deliveryLabel({ channel: 'email', status: 'skipped', reason: 'not_configured', count: 3 })).toBe(
      'Email · Not sent: Not set up on the server',
    )
    expect(deliveryLabel({ channel: 'email', status: 'deferred', reason: 'capped_daily', count: 1 })).toBe(
      'Email · Over the daily limit — goes in the daily digest',
    )
    expect(deliveryLabel({ channel: 'email', status: 'skipped', reason: 'digest_unsubscribed', count: 1 })).toBe(
      'Email · Not sent: Reporter unsubscribed',
    )
    expect(deliveryLabel({ channel: 'push', status: 'sent', reason: null, count: 2 })).toBe('Push · Sent')
    expect(deliveryLabel({ channel: 'email', status: 'sent', reason: 'digest', count: 2 })).toBe('Email · Sent in the daily digest')
  })

  it('flags an unconfigured provider and failures, not a reporter choice', () => {
    expect(deliveryNeedsAttention({ channel: 'email', status: 'skipped', reason: 'not_configured', count: 1 })).toBe(true)
    expect(deliveryNeedsAttention({ channel: 'email', status: 'failed', reason: 'error', count: 1 })).toBe(true)
    expect(deliveryNeedsAttention({ channel: 'email', status: 'skipped', reason: 'unsubscribed', count: 1 })).toBe(false)
  })

  it('sends every template key, blank meaning the built-in wording', () => {
    expect(templatesPayload({ fixed: '  Fixed!  ' })).toEqual({
      reviewing: '',
      fix_started: '',
      fixed: 'Fixed!',
      released: '',
      closed: '',
      duplicate_linked: '',
    })
  })

  it('checks placeholders and length like the server', () => {
    expect(templateProblem('Shipped in v{version}')).toBeNull()
    expect(templateProblem('Hi {name}')).toMatch(/\{name\}/)
    expect(templateProblem('x'.repeat(281))).toMatch(/280/)
    expect(templateProblem('')).toBeNull()
  })
})
