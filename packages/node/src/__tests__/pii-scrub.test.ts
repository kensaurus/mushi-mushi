import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MushiNodeClient } from '../client'
import { mushiExpressErrorHandler } from '../express'

const BASE_OPTIONS = {
  projectId: 'proj-test',
  apiKey: 'test-key',
  apiEndpoint: 'https://xyz.supabase.co/functions/v1/api',
}

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqYWtlIn0.abc-123_XYZ'

/**
 * RealWorld attunement: server-side wire parity with the web SDK's PII
 * scrubbing. Nothing containing query-string secrets, emails, or JWTs may
 * leave the process in a report or span payload.
 */
describe('node SDK wire-time PII scrubbing', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { reportId: 'r-123' } }),
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function postedBody(): Record<string, unknown> {
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    return JSON.parse(init.body as string) as Record<string, unknown>
  }

  it('scrubs description, url, and error text on captureReport', async () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    await client.captureReport({
      description: `Login failed for jake@example.com with ${JWT}`,
      url: '/api/users/login?token=supersecret&limit=10',
      error: { name: 'Error', message: `bad token ${JWT}`, stack: `Error: ${JWT}\n  at auth.ts:1` },
    })

    const body = postedBody()
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('jake@example.com')
    expect(raw).not.toContain(JWT)
    expect(raw).not.toContain('supersecret')
    expect(body['description']).toContain('[REDACTED_EMAIL]')
    const environment = body['environment'] as Record<string, unknown>
    expect(environment['url']).toBe('/api/users/login?token=[Scrubbed]&limit=10')
    const error = (body['metadata'] as Record<string, unknown>)['error'] as Record<string, unknown>
    expect(error['message']).toContain('[REDACTED_JWT]')
    expect(error['stack']).toContain('[REDACTED_JWT]')
  })

  it('express error handler reports a scrubbed request URL (Conduit Token auth)', async () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    const handler = mushiExpressErrorHandler({ client })

    const req = {
      method: 'POST',
      originalUrl: '/api/articles/x/favorite?token=supersecret&tag=dragons',
      headers: {},
    } as Parameters<typeof handler>[1]
    const res = { statusCode: 500 } as Parameters<typeof handler>[2]
    const next = vi.fn()

    handler(new Error('favorite exploded'), req, res, next)
    expect(next).toHaveBeenCalled()
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())

    const body = postedBody()
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('supersecret')
    expect(body['description']).toContain(
      '[POST /api/articles/x/favorite?token=[Scrubbed]&tag=dragons] favorite exploded',
    )
  })
})
