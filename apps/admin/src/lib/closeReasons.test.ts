import { describe, expect, it } from 'vitest'
import { CLOSE_REASONS, QUICK_CLOSE_REASONS, closeReasonNotice, closeReasonSentryNotice } from './closeReasons'

describe('close reasons', () => {
  it('quick closes leave out the one that needs grouping first', () => {
    expect(CLOSE_REASONS.map((r) => r.value)).toContain('duplicate')
    expect(QUICK_CLOSE_REASONS.map((r) => r.value)).toEqual(['not_reproducible', 'wont_fix', 'working_as_intended', 'spam'])
  })

  it('quotes the message the reporter gets', () => {
    expect(closeReasonNotice('not_reproducible')).toBe('The reporter sees “We couldn\'t reproduce it. Reply if it happens again.”')
    expect(closeReasonNotice('', 10)).toBe('Each reporter sees “Closed.”')
    expect(closeReasonNotice('spam', 2)).toBe('Closed as spam: reporters are not told.')
  })
})

describe('close reasons and Sentry', () => {
  it('says which reasons archive the linked Sentry issue, matching the server rule', () => {
    expect(closeReasonSentryNotice('working_as_intended')).toContain('archived')
    expect(closeReasonSentryNotice('wont_fix')).toContain('archived')
    for (const r of ['not_reproducible', 'duplicate', 'spam', '']) {
      expect(closeReasonSentryNotice(r)).toContain('stays open')
    }
  })
})
