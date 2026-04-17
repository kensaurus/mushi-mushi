import { describe, it, expect, vi } from 'vitest'
import { createZapierPlugin } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 't-secret'

function deliver(plugin: ReturnType<typeof createZapierPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

describe('createZapierPlugin', () => {
  it('forwards events to the Zapier hook', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"status":"success"}', { status: 200 }))
    const plugin = createZapierPlugin({
      zapierHookUrl: 'https://hooks.zapier.com/x/y/z',
      mushiSecret: SECRET,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    await deliver(plugin, {
      event: 'report.created',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'zapier',
      data: { report: { id: 'r-1', status: 'new' } },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.event).toBe('report.created')
    expect(body.report_id).toBe('r-1')
  })

  it('respects denyEvents', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const plugin = createZapierPlugin({
      zapierHookUrl: 'https://x',
      mushiSecret: SECRET,
      denyEvents: ['report.dedup_grouped'],
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    await deliver(plugin, {
      event: 'report.dedup_grouped',
      deliveryId: 'd-2',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'zapier',
      data: {},
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
