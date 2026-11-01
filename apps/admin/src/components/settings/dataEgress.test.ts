/**
 * FILE: apps/admin/src/components/settings/dataEgress.test.ts
 * PURPOSE: The Data egress card's sentences: the self-test verdict, refusals
 *          grouped by host and day, each integration's verdict, and one
 *          readable sentence for every way the two routes can fail.
 */

import { describe, expect, it } from 'vitest'
import { denialRows, egressErrorText, integrationVerdict, selftestSentence } from './dataEgress'

describe('selftestSentence', () => {
  it('passes only when every host was refused', () => {
    expect(
      selftestSentence({
        localOnly: true,
        passed: true,
        results: [
          { host: 'api.anthropic.com', outcome: 'blocked_by_mushi', ms: 1 },
          { host: 'sentry.io', outcome: 'network_unreachable', ms: 30 },
        ],
      }),
    ).toBe('Nothing left this stack: every test host was refused.')
  })

  it('names every reachable host', () => {
    expect(
      selftestSentence({
        localOnly: false,
        passed: false,
        results: [
          { host: 'api.openai.com', outcome: 'reachable', ms: 80 },
          { host: 'sentry.io', outcome: 'blocked_by_mushi', ms: 1 },
          { host: 'registry.npmjs.org', outcome: 'reachable', ms: 90 },
        ],
      }),
    ).toBe('These hosts were reachable: api.openai.com, registry.npmjs.org.')
  })

  it('does not call a failed run a pass when nothing was reachable', () => {
    expect(selftestSentence({ localOnly: true, passed: false, results: [] })).toMatch(/did not pass/)
  })
})

describe('denialRows', () => {
  it('sums callers per host and day, newest day first, then the most refused', () => {
    const rows = denialRows([
      { host: 'api.openai.com', caller: 'classify-report', day: '2026-10-20', count: 2, lastAt: '2026-10-20T09:00:00Z' },
      { host: 'sentry.io', caller: 'api', day: '2026-10-21', count: 1, lastAt: '2026-10-21T08:00:00Z' },
      { host: 'api.openai.com', caller: 'api', day: '2026-10-21', count: 3, lastAt: '2026-10-21T07:00:00Z' },
      { host: 'api.openai.com', caller: 'judge-batch', day: '2026-10-21', count: 4, lastAt: '2026-10-21T10:00:00Z' },
      { host: 'api.openai.com', caller: 'api', day: '2026-10-21', count: 1, lastAt: '2026-10-21T06:00:00Z' },
    ])
    expect(rows).toEqual([
      { host: 'api.openai.com', day: '2026-10-21', count: 8, callers: ['api', 'judge-batch'], lastAt: '2026-10-21T10:00:00Z' },
      { host: 'sentry.io', day: '2026-10-21', count: 1, callers: ['api'], lastAt: '2026-10-21T08:00:00Z' },
      { host: 'api.openai.com', day: '2026-10-20', count: 2, callers: ['classify-report'], lastAt: '2026-10-20T09:00:00Z' },
    ])
  })
})

describe('integrationVerdict', () => {
  const row = { id: 'firecrawl', label: 'Firecrawl', destination: 'api.firecrawl.dev', enabled: true, allowed: false, note: null }

  it('reads Off for an integration that is not turned on', () => {
    expect(integrationVerdict({ ...row, enabled: false }, true)).toEqual({ label: 'Off', tone: 'neutral' })
  })

  it('reads Refused under local-only unless the host is allowed', () => {
    expect(integrationVerdict(row, true)).toEqual({ label: 'Refused', tone: 'ok' })
    expect(integrationVerdict({ ...row, allowed: true }, true)).toEqual({ label: 'Allowed', tone: 'warn' })
  })

  it('reads Sends data when local-only is off', () => {
    expect(integrationVerdict(row, false)).toEqual({ label: 'Sends data', tone: 'warn' })
  })
})

describe('egressErrorText', () => {
  it('tells a viewer why the self-test is refused', () => {
    expect(egressErrorText({ code: 'FORBIDDEN', message: 'Forbidden' }, 'selftest')).toMatch(/Viewers can see this card/)
    expect(egressErrorText({ code: 'HTTP_ERROR', message: '403: {}' }, 'selftest')).toMatch(/Viewers/)
  })

  it('asks to wait after a rate limit', () => {
    expect(egressErrorText({ code: 'RATE_LIMITED', message: 'Too many' }, 'selftest')).toMatch(/Wait a minute/)
    expect(egressErrorText({ code: 'HTTP_ERROR', message: '429: slow down' }, 'selftest')).toMatch(/Wait a minute/)
  })

  it('says the server is too old when the route is missing', () => {
    expect(egressErrorText({ code: 'NOT_FOUND', message: 'Not found' }, 'status')).toMatch(/does not have the data egress check/)
  })

  it('blames the server, not the user, on a 5xx', () => {
    expect(egressErrorText({ code: 'HTTP_ERROR', message: '502: Bad Gateway' }, 'selftest')).toMatch(
      /server could not run the self-test/,
    )
    expect(egressErrorText({ code: 'INTERNAL', message: 'boom' }, 'status')).toMatch(/could not read the egress status/)
  })

  it('never shows a bare code', () => {
    expect(egressErrorText({ code: 'WEIRD', message: 'WEIRD' }, 'selftest')).toBe('The self-test could not run.')
    expect(egressErrorText(undefined, 'status')).toBe('Could not load the egress status.')
  })
})
