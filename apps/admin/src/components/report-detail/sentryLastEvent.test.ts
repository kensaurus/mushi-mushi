import { describe, expect, it } from 'vitest'
import { sentryLastEventAt } from './sentryLastEvent'

describe('sentryLastEventAt', () => {
  it('is when Mushi Mushi filed a Sentry report', () => {
    expect(sentryLastEventAt({ source: 'sentry', created_at: '2026-11-17T16:38:08.824Z', regressed_at: null })).toBe('2026-11-17T16:38:08.824Z')
  })

  it('a later regression from Sentry moves it forward', () => {
    expect(
      sentryLastEventAt({ source: 'sentry', created_at: '2026-11-17T16:38:08.824Z', regressed_at: '2026-11-21T09:00:00.000Z' }),
    ).toBe('2026-11-21T09:00:00.000Z')
  })

  it('recognises an older Sentry row by its webhook user agent', () => {
    expect(
      sentryLastEventAt({ source: null, created_at: '2026-11-17T16:38:08.824Z', environment: { userAgent: 'sentry-webhook' } }),
    ).toBe('2026-11-17T16:38:08.824Z')
  })

  it('is null for a report that did not come from Sentry', () => {
    expect(sentryLastEventAt({ source: 'widget', created_at: '2026-11-17T16:38:08.824Z' })).toBeNull()
  })
})
