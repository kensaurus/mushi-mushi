import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MushiNodeClient } from '../client'

const BASE_OPTIONS = {
  projectId: 'proj-test',
  apiKey: 'test-key',
  apiEndpoint: 'https://xyz.supabase.co/functions/v1/api',
}

describe('MushiNodeClient.track', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { accepted: 1, dropped: 0 } }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('POSTs one server-surface event to /v1/sdk/events with user_id = distinctId', async () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    const result = await client.track('upgrade_completed', {
      distinctId: 'user-42',
      properties: { plan: 'pro', seats: 3, email: 'a@b.c', $surface: 'web' },
      dedupKey: 'sub_123',
      timestamp: new Date('2026-09-21T00:00:00Z'),
    })

    expect(result).toEqual({ ok: true, accepted: 1 })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://xyz.supabase.co/functions/v1/api/v1/sdk/events')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body as string) as {
      user_id: string
      surface: string
      sdk_version: string
      events: Array<{ name: string; ts: string; properties: Record<string, unknown>; dedup_key?: string }>
    }
    expect(body.user_id).toBe('user-42')
    expect(body.surface).toBe('server')
    expect(body.sdk_version).toMatch(/^\d+\.\d+\.\d+/)
    expect(body.events).toHaveLength(1)
    const ev = body.events[0]!
    expect(ev.name).toBe('upgrade_completed')
    expect(ev.ts).toBe('2026-09-21T00:00:00.000Z')
    expect(ev.dedup_key).toBe('sub_123')
    expect(ev.properties).toEqual({ plan: 'pro', seats: 3, $surface: 'server' })

    const headers = init.headers as Record<string, string>
    expect(headers['X-Mushi-Api-Key']).toBe('test-key')
    expect(headers['X-Mushi-Project']).toBe('proj-test')
    expect(headers['X-Mushi-SDK-Package']).toBe('@mushi-mushi/node')
  })

  it('rejects an invalid event name or a missing distinctId without touching the network', async () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    expect(await client.track('Bad Name', { distinctId: 'u' })).toEqual({ ok: false })
    expect(await client.track('fine_name', { distinctId: '' })).toEqual({ ok: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never throws: HTTP failures and network errors return ok:false', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
    const client = new MushiNodeClient(BASE_OPTIONS)
    expect(await client.track('a_event', { distinctId: 'u' })).toEqual({ ok: false })

    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await client.track('b_event', { distinctId: 'u' })).toEqual({ ok: false })
  })

  it('shares the circuit breaker with captureReport', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const client = new MushiNodeClient({ ...BASE_OPTIONS, circuitBreaker: { enabled: true, threshold: 2, cooldownMs: 60_000 } })
    await client.track('a_event', { distinctId: 'u' })
    await client.track('a_event', { distinctId: 'u' })
    const callsBefore = fetchSpy.mock.calls.length
    await client.track('a_event', { distinctId: 'u' })
    expect(fetchSpy.mock.calls.length).toBe(callsBefore)
  })
})
