import { describe, it, expect, vi } from 'vitest'
import { createMsteamsPlugin } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 'test-secret'
const WEBHOOK = 'https://outlook.office.com/webhook/xxx/IncomingWebhook/yyy'

function deliver(plugin: ReturnType<typeof createMsteamsPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

interface TeamsPayload {
  type: string
  attachments: Array<{
    contentType: string
    content: {
      type: string
      version: string
      $schema: string
      body: unknown[]
      actions: Array<{ type: string; title: string; url: string }>
    }
  }>
}

describe('createMsteamsPlugin', () => {
  function makePlugin(overrides: Partial<Parameters<typeof createMsteamsPlugin>[0]> = {}) {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const plugin = createMsteamsPlugin({
      webhookUrl: WEBHOOK,
      adminBaseUrl: 'https://admin.example.com',
      mushiSecret: SECRET,
      fetchImpl: fetchMock as unknown as typeof fetch,
      ...overrides,
    })
    return { plugin, fetchMock }
  }

  it('POSTs an Adaptive Card on report.classified', async () => {
    const { plugin, fetchMock } = makePlugin()
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'msteams',
      data: {
        report: { id: 'r-1111-2222', status: 'classified', title: 'App crashes on startup' },
        classification: { severity: 'critical', category: 'crash', confidence: 0.98 },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(WEBHOOK)
    expect(init.method).toBe('POST')

    const payload = JSON.parse(init.body as string) as TeamsPayload
    expect(payload.type).toBe('message')
    expect(payload.attachments).toHaveLength(1)

    const card = payload.attachments[0].content
    expect(card.type).toBe('AdaptiveCard')
    expect(card.version).toBe('1.4')
    expect(card.$schema).toContain('adaptivecards.io')
    expect(Array.isArray(card.body)).toBe(true)
    expect(Array.isArray(card.actions)).toBe(true)

    const openAction = card.actions.find((a) => a.type === 'Action.OpenUrl' && a.title === 'View in Mushi')
    expect(openAction).toBeDefined()
    expect(openAction?.url).toContain('r-1111-2222')
  })

  it('POSTs an Adaptive Card on fix.proposed with PR action', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'fix.proposed',
      deliveryId: 'd-2',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'msteams',
      data: {
        report: { id: 'r-2', status: 'fix_proposed' },
        fix: {
          id: 'f-1',
          status: 'open',
          pullRequestUrl: 'https://github.com/acme/app/pull/55',
          summary: 'Fixes NPE in LoginActivity',
        },
      },
    })
    const payload = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as TeamsPayload
    const actions = payload.attachments[0].content.actions
    expect(actions.some((a) => a.url === 'https://github.com/acme/app/pull/55')).toBe(true)
  })

  it('POSTs an Adaptive Card on fix.applied', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-3',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'msteams',
      data: {
        report: { id: 'r-3', status: 'fixed' },
        fix: { id: 'f-2', status: 'merged' },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as TeamsPayload
    expect(payload.type).toBe('message')
    const container = payload.attachments[0].content.body[0] as { style: string }
    expect(container.style).toBe('good')
  })

  it('does not post for unhandled events (acks silently)', async () => {
    const { plugin, fetchMock } = makePlugin()
    const res = await deliver(plugin, {
      event: 'judge.score_recorded',
      deliveryId: 'd-x',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'msteams',
      data: { report: { id: 'r-x', status: 'reviewed' }, judge: { score: 8, rationale: 'ok', promptVersion: 'v1' } },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
