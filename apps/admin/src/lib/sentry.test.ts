/**
 * The admin Sentry data-collection policy (SDK 11 `dataCollection`, which
 * replaced `sendDefaultPii: false`) must not collect more than v10 did.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  BrowserClient,
  createTransport,
  httpContextIntegration,
  type Event,
} from '@sentry/react'
import { SENTRY_ALLOWED_REQUEST_HEADERS, SENTRY_DATA_COLLECTION } from './sentry'

describe('SENTRY_DATA_COLLECTION headers', () => {
  it('collects only the two request headers v10 sent, and no response headers', () => {
    expect(SENTRY_DATA_COLLECTION.httpHeaders).toEqual({
      request: { allow: ['user-agent', 'referer'] },
      response: false,
    })
  })

  it('allows no credential, cookie or identifying header name', () => {
    // The SDK keeps a header when its lower-cased name contains an allow term.
    const allowed = (name: string) =>
      SENTRY_ALLOWED_REQUEST_HEADERS.some(term => name.toLowerCase().includes(term))
    for (const name of [
      'Authorization', 'Proxy-Authorization', 'Cookie', 'Set-Cookie', 'X-Api-Key', 'apikey',
      'X-Mushi-Api-Key', 'X-CSRF-Token', 'X-Forwarded-For', 'X-Real-IP', 'Forwarded',
      'CF-Connecting-IP', 'X-User-Id', 'X-Supabase-Auth',
    ]) {
      expect(allowed(name), name).toBe(false)
    }
    expect(allowed('User-Agent')).toBe(true)
    expect(allowed('Referer')).toBe(true)
  })

  it('keeps no other personal-data category on', () => {
    expect(SENTRY_DATA_COLLECTION.userInfo).toBe(false)
    expect(SENTRY_DATA_COLLECTION.cookies).toBe(false)
    expect(SENTRY_DATA_COLLECTION.httpBodies).toEqual([])
    expect(SENTRY_DATA_COLLECTION.stackFrameVariables).toBe(false)
  })
})

describe('SENTRY_DATA_COLLECTION with the real browser SDK', () => {
  const originalReferrer = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer')
  afterEach(() => {
    if (originalReferrer) Object.defineProperty(document, 'referrer', { ...originalReferrer, configurable: true })
  })

  it('still sends User-Agent and Referer (token query params redacted) like v10 did', async () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => 'https://example.test/from?token=secret123&tab=1',
    })
    const sent: Event[] = []
    const client = new BrowserClient({
      dsn: 'https://public@o0.ingest.sentry.io/0',
      dataCollection: SENTRY_DATA_COLLECTION,
      integrations: [httpContextIntegration()],
      stackParser: () => [],
      transport: options =>
        createTransport(options, async () => ({ statusCode: 200 })),
      beforeSend(event) {
        sent.push(event)
        return null
      },
    })
    client.init()
    client.captureMessage('privacy check')
    await client.flush(1000)

    const headers = sent[0]?.request?.headers ?? {}
    expect(Object.keys(headers).sort()).toEqual(['Referer', 'User-Agent'])
    expect(headers['User-Agent']).toBe(navigator.userAgent)
    expect(headers['Referer']).not.toContain('secret123')
  })
})
