import { describe, it, expect, vi } from 'vitest'
import { createLinearPlugin } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 'test-secret'

function deliver(plugin: ReturnType<typeof createLinearPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

describe('createLinearPlugin', () => {
  it('creates a Linear issue on report.created and dedups subsequent events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { issueCreate: { issue: { id: 'lin-1' } }, issueUpdate: { success: true } } }), { status: 200 }),
    )
    const plugin = createLinearPlugin({
      linearApiKey: 'lin-key',
      teamId: 'team-1',
      mushiSecret: SECRET,
      mushiApiKey: 'mushi-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await deliver(plugin, {
      event: 'report.created',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'linear',
      data: { report: { id: 'r-1', status: 'new' } },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-2',
      occurredAt: '2026-04-17T00:00:01Z',
      projectId: 'p-1',
      pluginSlug: 'linear',
      data: { report: { id: 'r-1', status: 'classified' }, classification: { severity: 'high', category: 'bug', confidence: 0.9 } },
    })
    // Second call: ensureIssue uses cache (no create) but issueUpdate fires.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
