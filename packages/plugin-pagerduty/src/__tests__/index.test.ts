import { describe, it, expect, vi } from 'vitest'
import { createPagerDutyPlugin } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 'test-secret'

function deliver(plugin: ReturnType<typeof createPagerDutyPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

describe('createPagerDutyPlugin', () => {
  it('pages on critical classified events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }))
    const plugin = createPagerDutyPlugin({ routingKey: 'rk', mushiSecret: SECRET, fetchImpl: fetchMock as unknown as typeof fetch })
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'pagerduty',
      data: { report: { id: 'r-1', status: 'classified' }, classification: { severity: 'critical', category: 'bug', confidence: 0.9 } },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('skips below-threshold events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }))
    const plugin = createPagerDutyPlugin({ routingKey: 'rk', mushiSecret: SECRET, fetchImpl: fetchMock as unknown as typeof fetch })
    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-2',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'pagerduty',
      data: { report: { id: 'r-2', status: 'classified' }, classification: { severity: 'low', category: 'bug', confidence: 0.5 } },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
