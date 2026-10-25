/**
 * FILE: apps/admin/src/lib/sentry.test.ts
 * PURPOSE: SDK 11 removed `sendDefaultPii`. Init must keep the v10 restrictive
 *          collection baseline, or an unset `dataCollection` starts sending
 *          user info, cookies, and HTTP bodies.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const init = vi.fn()

vi.mock('@sentry/react', () => ({
  init: (...args: unknown[]) => init(...args),
  makeFetchTransport: () => ({ send: vi.fn() }),
  createTransport: () => ({ send: vi.fn(), flush: async () => true }),
  reactRouterV7BrowserTracingIntegration: () => ({ name: 'BrowserTracing' }),
}))

import { initSentry, sentryDataCollection } from './sentry'

const V10_RESTRICTIVE_BASELINE = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
    response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
  },
  httpBodies: [],
  urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  graphQL: { document: false, variables: false },
}

describe('initSentry', () => {
  beforeEach(() => {
    init.mockClear()
    vi.unstubAllEnvs()
  })

  it('does nothing without a DSN', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    initSentry()
    expect(init).not.toHaveBeenCalled()
  })

  it('uses dataCollection and does not send the removed sendDefaultPii flag', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o1.ingest.sentry.io/1')
    initSentry()
    expect(init).toHaveBeenCalledTimes(1)
    const options = init.mock.calls[0]?.[0] as { sendDefaultPii?: boolean; dataCollection: unknown }
    expect(options.sendDefaultPii).toBeUndefined()
    expect(options.dataCollection).toEqual(sentryDataCollection)
    expect(sentryDataCollection).toEqual(V10_RESTRICTIVE_BASELINE)
  })
})
