import { describe, it, expect, vi } from 'vitest'
import { createBugsnagPlugin, type BugsnagErrorCache } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 'test-secret'

function deliver(plugin: ReturnType<typeof createBugsnagPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

describe('createBugsnagPlugin', () => {
  function makePlugin(overrides: Partial<Parameters<typeof createBugsnagPlugin>[0]> = {}) {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'bugsnag-err-1' }), { status: 200 }))
    const plugin = createBugsnagPlugin({
      apiKey: 'test-api-key',
      projectSlug: 'my-project',
      adminBaseUrl: 'https://admin.example.com',
      mushiSecret: SECRET,
      fetchImpl: fetchMock as unknown as typeof fetch,
      ...overrides,
    })
    return { plugin, fetchMock }
  }

  it('POSTs to Bugsnag errors endpoint on report.classified', async () => {
    const { plugin, fetchMock } = makePlugin()
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'bugsnag',
      data: {
        report: { id: 'r-1', status: 'classified', title: 'App crash on launch' },
        classification: { severity: 'high', category: 'crash', confidence: 0.95 },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.bugsnag.com/v2/projects/my-project/errors')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('token test-api-key')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['groupingHash']).toBe('mushi-p-1-r-1')
    expect(body['severity']).toBe('error')
    expect(body['message']).toBe('App crash on launch')
    const meta = body['metaData'] as { mushi: Record<string, unknown> }
    expect(meta.mushi['reportId']).toBe('r-1')
    expect(meta.mushi['reportUrl']).toContain('r-1')
  })

  it('maps medium severity to warning', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-2',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'bugsnag',
      data: {
        report: { id: 'r-2', status: 'classified' },
        classification: { severity: 'medium', category: 'ui', confidence: 0.7 },
      },
    })
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.severity).toBe('warning')
  })

  it('PATCHes the error as fixed on fix.applied when error ID is cached', async () => {
    const mockCache: BugsnagErrorCache = {
      get: vi.fn().mockResolvedValue('bugsnag-err-99'),
      set: vi.fn(),
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const plugin = createBugsnagPlugin(
      {
        apiKey: 'test-api-key',
        projectSlug: 'my-project',
        adminBaseUrl: 'https://admin.example.com',
        mushiSecret: SECRET,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
      mockCache,
    )

    await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-3',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'bugsnag',
      data: {
        report: { id: 'r-1', status: 'fixed' },
        fix: { id: 'f-1', status: 'merged' },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v2/projects/my-project/errors/bugsnag-err-99')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['status']).toBe('fixed')
  })

  it('skips fix.applied when no error ID is cached', async () => {
    const mockCache: BugsnagErrorCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    }
    const fetchMock = vi.fn()
    const plugin = createBugsnagPlugin(
      {
        apiKey: 'test-api-key',
        projectSlug: 'my-project',
        adminBaseUrl: 'https://admin.example.com',
        mushiSecret: SECRET,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
      mockCache,
    )

    await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-4',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'bugsnag',
      data: {
        report: { id: 'r-missing', status: 'fixed' },
        fix: { id: 'f-2', status: 'merged' },
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
