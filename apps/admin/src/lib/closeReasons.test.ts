import { describe, expect, it } from 'vitest'
import { CLOSE_REASONS, QUICK_CLOSE_REASONS, closeReasonNotice, closeReasonSentryNotice, closeReasonsFor } from './closeReasons'

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

  it('offers a false alarm only for a report Mushi filed, and tells nobody', () => {
    expect(closeReasonsFor('widget').map((r) => r.value)).not.toContain('false_alarm')
    expect(closeReasonsFor(undefined).map((r) => r.value)).not.toContain('false_alarm')
    for (const source of ['site_audit', 'site_watch', 'security_advisory']) {
      expect(closeReasonsFor(source).find((r) => r.value === 'false_alarm')?.label).toBe("False alarm (Mushi's check was wrong)")
    }
    const told = "Closed as a false alarm: nobody is told. Mushi's check was wrong."
    expect(closeReasonNotice('false_alarm')).toBe(told)
    expect(closeReasonNotice('false_alarm', 3)).toBe(told)
  })
})

describe('close reasons and Sentry', () => {
  it('says which reasons archive the linked Sentry issue, matching the server rule', () => {
    expect(closeReasonSentryNotice('working_as_intended')).toContain('archived')
    expect(closeReasonSentryNotice('wont_fix')).toContain('archived')
    for (const r of ['not_reproducible', 'duplicate', 'spam', 'false_alarm', '']) {
      expect(closeReasonSentryNotice(r)).toContain('stays open')
    }
  })
})
