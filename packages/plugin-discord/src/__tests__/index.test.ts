import { describe, it, expect, vi } from 'vitest'
import { createDiscordPlugin } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 'test-secret'
const WEBHOOK = 'https://discord.com/api/webhooks/123/abc'

function deliver(plugin: ReturnType<typeof createDiscordPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

describe('createDiscordPlugin', () => {
  function makePlugin(overrides: Partial<Parameters<typeof createDiscordPlugin>[0]> = {}) {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const plugin = createDiscordPlugin({
      webhookUrl: WEBHOOK,
      adminBaseUrl: 'https://admin.example.com',
      mushiSecret: SECRET,
      fetchImpl: fetchMock as unknown as typeof fetch,
      ...overrides,
    })
    return { plugin, fetchMock }
  }

  it('POSTs a Discord embed on report.classified', async () => {
    const { plugin, fetchMock } = makePlugin()
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'discord',
      data: {
        report: { id: 'r-1111-2222-3333', status: 'classified', title: 'App freezes on login' },
        classification: { severity: 'critical', category: 'crash', confidence: 0.97 },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(WEBHOOK)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as { embeds: Array<Record<string, unknown>> }
    expect(body.embeds).toHaveLength(1)
    const embed = body.embeds[0]
    expect(embed['color']).toBe(0xff0000)
    expect(embed['title']).toContain('crash')
    expect(embed['url']).toContain('r-1111-2222-3333')
    const fields = embed['fields'] as Array<{ name: string; value: string }>
    expect(fields.some((f) => f.name === 'Severity' && f.value === 'critical')).toBe(true)
  })

  it('uses orange color for high severity', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-2',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'discord',
      data: {
        report: { id: 'r-2', status: 'classified' },
        classification: { severity: 'high', category: 'ui', confidence: 0.8 },
      },
    })
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      embeds: Array<{ color: number }>
    }
    expect(body.embeds[0].color).toBe(0xff6600)
  })

  it('POSTs fix.proposed embed with PR URL field', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'fix.proposed',
      deliveryId: 'd-3',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'discord',
      data: {
        report: { id: 'r-3', status: 'fix_proposed' },
        fix: { id: 'f-1', status: 'open', pullRequestUrl: 'https://github.com/acme/app/pull/99' },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      embeds: Array<{ color: number; fields: Array<{ name: string; value: string }> }>
    }
    expect(body.embeds[0].color).toBe(0x5865f2)
    expect(body.embeds[0].fields.some((f) => f.value === 'https://github.com/acme/app/pull/99')).toBe(true)
  })

  it('POSTs fix.applied embed with green color', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-4',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'discord',
      data: {
        report: { id: 'r-4', status: 'fixed' },
        fix: { id: 'f-2', status: 'merged' },
      },
    })
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      embeds: Array<{ color: number }>
    }
    expect(body.embeds[0].color).toBe(0x57f287)
  })

  it('POSTs report.status_changed embed', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'report.status_changed',
      deliveryId: 'd-5',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'discord',
      data: {
        report: { id: 'r-5', status: 'reviewing' },
        previousStatus: 'new',
        newStatus: 'reviewing',
      },
    })
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      embeds: Array<{ color: number; description: string }>
    }
    expect(body.embeds[0].color).toBe(0x99aab5)
    expect(body.embeds[0].description).toContain('new')
    expect(body.embeds[0].description).toContain('reviewing')
  })
})
