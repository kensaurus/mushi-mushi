import { describe, expect, it } from 'vitest'
import { sentryLastEventAt, sentryLastSeenAt } from './sentryLastEvent'

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

describe('sentryLastSeenAt', () => {
  const link = (last_seen_at?: string | null) => ({ external_id: '4501', external_url: null, resolved_at: null, last_seen_at })

  it("is Sentry's own last seen, the newest across the report's issues", () => {
    expect(sentryLastSeenAt([link('2026-11-20T00:00:00Z'), link('2026-11-22T09:30:00Z')])).toBe('2026-11-22T09:30:00.000Z')
  })

  it('is null when no link recorded one (older links, or an API from before 2026-11-22)', () => {
    expect(sentryLastSeenAt([link(null), link(undefined)])).toBeNull()
    expect(sentryLastSeenAt([{ external_id: '4501', external_url: null, resolved_at: null }])).toBeNull()
    expect(sentryLastSeenAt(null)).toBeNull()
  })
})
