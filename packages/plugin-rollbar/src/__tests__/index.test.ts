import { describe, it, expect, vi } from 'vitest'
import { createRollbarPlugin, type RollbarItemCache } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 'test-secret'

function deliver(plugin: ReturnType<typeof createRollbarPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

describe('createRollbarPlugin', () => {
  function makePlugin(overrides: Partial<Parameters<typeof createRollbarPlugin>[0]> = {}) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { id: 42 } }), { status: 200 }),
    )
    const plugin = createRollbarPlugin({
      accessToken: 'rollbar-token',
      projectId: 'proj-123',
      adminBaseUrl: 'https://admin.example.com',
      mushiSecret: SECRET,
      fetchImpl: fetchMock as unknown as typeof fetch,
      ...overrides,
    })
    return { plugin, fetchMock }
  }

  it('POSTs to Rollbar /api/1/item/ on report.classified', async () => {
    const { plugin, fetchMock } = makePlugin()
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'rollbar',
      data: {
        report: { id: 'r-1', status: 'classified', title: 'Login crashes on submit' },
        classification: { severity: 'critical', category: 'crash', confidence: 0.99 },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.rollbar.com/api/1/item/')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Rollbar-Access-Token']).toBe('rollbar-token')
    const body = JSON.parse(init.body as string) as { data: Record<string, unknown> }
    expect(body.data['level']).toBe('critical')
    expect(body.data['fingerprint']).toBe('mushi-p-1-r-1')
    const custom = body.data['custom'] as Record<string, unknown>
    expect(custom['mushi_report_id']).toBe('r-1')
    expect(custom['mushi_report_url']).toContain('r-1')
  })

  it('maps severity correctly: high → error, medium → warning, low → info', async () => {
    for (const [severity, level] of [
      ['high', 'error'],
      ['medium', 'warning'],
      ['low', 'info'],
    ] as const) {
      const { plugin, fetchMock } = makePlugin()
      await deliver(plugin, {
        event: 'report.classified',
        deliveryId: `d-sev-${severity}`,
        occurredAt: '2026-04-17T00:00:00Z',
        projectId: 'p-1',
        pluginSlug: 'rollbar',
        data: {
          report: { id: `r-${severity}`, status: 'classified' },
          classification: { severity, category: 'ui', confidence: 0.6 },
        },
      })
      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
        data: { level: string }
      }
      expect(body.data.level).toBe(level)
    }
  })

  it('PATCHes item as resolved on fix.applied when item ID is cached', async () => {
    const mockCache: RollbarItemCache = {
      get: vi.fn().mockResolvedValue('77'),
      set: vi.fn(),
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const plugin = createRollbarPlugin(
      {
        accessToken: 'rollbar-token',
        projectId: 'proj-123',
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
      pluginSlug: 'rollbar',
      data: {
        report: { id: 'r-1', status: 'fixed' },
        fix: { id: 'f-1', status: 'merged' },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/1/item/77')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['status']).toBe('resolved')
  })

  it('skips fix.applied when no item ID is cached', async () => {
    const mockCache: RollbarItemCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    }
    const fetchMock = vi.fn()
    const plugin = createRollbarPlugin(
      {
        accessToken: 'rollbar-token',
        projectId: 'proj-123',
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
      pluginSlug: 'rollbar',
      data: {
        report: { id: 'r-missing', status: 'fixed' },
        fix: { id: 'f-2', status: 'merged' },
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
