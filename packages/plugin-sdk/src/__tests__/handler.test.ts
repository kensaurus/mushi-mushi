import { describe, it, expect } from 'vitest'
import { createPluginHandler } from '../handler.js'
import { signPayload } from '../sign.js'
import type { MushiEventEnvelope } from '../types.js'

const SECRET = 's-test'

function envelope(overrides: Partial<MushiEventEnvelope> = {}): MushiEventEnvelope {
  return {
    event: 'report.created',
    deliveryId: overrides.deliveryId ?? `d-${Math.random()}`,
    occurredAt: '2026-04-17T00:00:00Z',
    projectId: 'proj-1',
    pluginSlug: 'test-plugin',
    data: { report: { id: 'r-1', status: 'open' } },
    ...overrides,
  }
}

describe('createPluginHandler', () => {
  it('rejects invalid signatures with 401', async () => {
    const handler = createPluginHandler({ secret: SECRET, on: { 'report.created': async () => {} } })
    const result = await handler({ rawBody: '{}', headers: {} })
    expect(result.status).toBe(401)
    expect(result.body.ok).toBe(false)
  })

  it('runs the matching handler and returns 200', async () => {
    const captured: { value: MushiEventEnvelope | null } = { value: null }
    const handler = createPluginHandler({
      secret: SECRET,
      on: { 'report.created': async (e) => { captured.value = e } },
    })
    const env = envelope()
    const body = JSON.stringify(env)
    const result = await handler({
      rawBody: body,
      headers: { 'x-mushi-signature': signPayload(SECRET, body) },
    })
    expect(result.status).toBe(200)
    expect(captured.value?.deliveryId).toBe(env.deliveryId)
  })

  it('falls back to the wildcard handler', async () => {
    let count = 0
    const handler = createPluginHandler({
      secret: SECRET,
      on: { '*': async () => { count++ } },
    })
    const env = envelope({ event: 'report.dedup_grouped' })
    const body = JSON.stringify(env)
    await handler({ rawBody: body, headers: { 'x-mushi-signature': signPayload(SECRET, body) } })
    expect(count).toBe(1)
  })

  it('dedups repeated deliveries by deliveryId', async () => {
    let count = 0
    const handler = createPluginHandler({
      secret: SECRET,
      on: { 'report.created': async () => { count++ } },
    })
    const env = envelope({ deliveryId: 'fixed-id' })
    const body = JSON.stringify(env)
    const headers = { 'x-mushi-signature': signPayload(SECRET, body) }
    await handler({ rawBody: body, headers })
    await handler({ rawBody: body, headers })
    expect(count).toBe(1)
  })

  it('returns 500 if the handler throws', async () => {
    const handler = createPluginHandler({
      secret: SECRET,
      on: { 'report.created': async () => { throw new Error('boom') } },
    })
    const env = envelope()
    const body = JSON.stringify(env)
    const result = await handler({ rawBody: body, headers: { 'x-mushi-signature': signPayload(SECRET, body) } })
    expect(result.status).toBe(500)
  })
})
