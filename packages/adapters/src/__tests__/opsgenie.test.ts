import { describe, it, expect } from 'vitest'
import { createOpsGenieAdapter, translateOpsGenie } from '../opsgenie.js'
import { computeHmacSha256Base64, makeSink, makeReq } from './shared-hmac-fixtures.js'

const SIGNING_KEY = 'opsgenie-signing-key-secret'

describe('translateOpsGenie', () => {
  it('maps P1 to critical severity', () => {
    const result = translateOpsGenie({
      action: 'Create',
      alert: { alertId: 'a1', message: 'Prod DB down', priority: 'P1', tinyId: '42' },
    })
    expect(result.description).toBe('Prod DB down')
    expect(result.severity).toBe('critical')
    expect(result.category).toBe('bug')
    expect(result.source).toBe('opsgenie')
    expect(result.metadata?.action).toBe('Create')
  })

  it('maps P2 to high severity', () => {
    const result = translateOpsGenie({ alert: { message: 'API latency spike', priority: 'P2' } })
    expect(result.severity).toBe('high')
  })

  it('maps P3 to medium severity', () => {
    const result = translateOpsGenie({ alert: { message: 'minor alert', priority: 'P3' } })
    expect(result.severity).toBe('medium')
  })

  it('maps P4 to medium severity', () => {
    const result = translateOpsGenie({ alert: { message: 'low priority', priority: 'P4' } })
    expect(result.severity).toBe('medium')
  })

  it('maps P5 to low severity', () => {
    const result = translateOpsGenie({ alert: { message: 'informational', priority: 'P5' } })
    expect(result.severity).toBe('low')
  })

  it('handles Acknowledge action', () => {
    const result = translateOpsGenie({ action: 'Acknowledge', alert: { message: 'acked', priority: 'P2' } })
    expect(result.metadata?.action).toBe('Acknowledge')
    expect(result.severity).toBe('high')
  })

  it('handles Close action', () => {
    const result = translateOpsGenie({ action: 'Close', alert: { message: 'closed', priority: 'P3' } })
    expect(result.metadata?.action).toBe('Close')
  })

  it('handles Escalate action', () => {
    const result = translateOpsGenie({ action: 'Escalate', alert: { message: 'escalated', priority: 'P1' } })
    expect(result.metadata?.action).toBe('Escalate')
    expect(result.severity).toBe('critical')
  })

  it('parses key:value tags into tags record', () => {
    const result = translateOpsGenie({
      alert: { message: 'tagged alert', tags: ['service:payments', 'env:prod', 'noisetag'] },
    })
    expect(result.tags?.service).toBe('payments')
    expect(result.tags?.env).toBe('prod')
    expect(result.tags?.noisetag).toBeUndefined()
  })

  it('uses projectName option over alert entity', () => {
    const result = translateOpsGenie({ alert: { message: 'test', entity: 'payload-entity' } }, 'my-project')
    expect(result.component).toBe('my-project')
  })

  it('falls back to alert entity when no projectName', () => {
    const result = translateOpsGenie({ alert: { message: 'test', entity: 'entity-name' } })
    expect(result.component).toBe('entity-name')
  })
})

describe('createOpsGenieAdapter', () => {
  it('returns 401 when signature header is missing', async () => {
    const { sink } = makeSink()
    const handler = createOpsGenieAdapter({ sink, signingKey: SIGNING_KEY })
    const res = await handler(makeReq({ action: 'Create' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid HMAC signature', async () => {
    const { sink } = makeSink()
    const handler = createOpsGenieAdapter({ sink, signingKey: SIGNING_KEY })
    const res = await handler(makeReq({ action: 'Create' }, { 'x-og-signature': 'badsig==' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    const { sink } = makeSink()
    const handler = createOpsGenieAdapter({ sink, signingKey: SIGNING_KEY })
    const rawBody = 'not-json'
    const sig = computeHmacSha256Base64(SIGNING_KEY, rawBody)
    const res = await handler({ headers: { 'x-og-signature': sig }, rawBody })
    expect(res.status).toBe(400)
  })

  it('returns 200 and calls sink for valid Create action', async () => {
    const { sink, calls } = makeSink()
    const handler = createOpsGenieAdapter({ sink, signingKey: SIGNING_KEY })
    const body = { action: 'Create', alert: { message: 'Prod is on fire', priority: 'P1' } }
    const rawBody = JSON.stringify(body)
    const sig = computeHmacSha256Base64(SIGNING_KEY, rawBody)
    const res = await handler({ headers: { 'x-og-signature': sig }, rawBody })
    expect(res.status).toBe(200)
    expect((res.body as { ok: boolean }).ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('returns 200 and calls sink for Acknowledge action', async () => {
    const { sink, calls } = makeSink()
    const handler = createOpsGenieAdapter({ sink, signingKey: SIGNING_KEY })
    const body = { action: 'Acknowledge', alert: { message: 'Acknowledged', priority: 'P2' } }
    const rawBody = JSON.stringify(body)
    const sig = computeHmacSha256Base64(SIGNING_KEY, rawBody)
    const res = await handler({ headers: { 'x-og-signature': sig }, rawBody })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('returns 200 and calls sink for Close action', async () => {
    const { sink, calls } = makeSink()
    const handler = createOpsGenieAdapter({ sink, signingKey: SIGNING_KEY })
    const body = { action: 'Close', alert: { message: 'Resolved', priority: 'P3' } }
    const rawBody = JSON.stringify(body)
    const sig = computeHmacSha256Base64(SIGNING_KEY, rawBody)
    const res = await handler({ headers: { 'x-og-signature': sig }, rawBody })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('returns 200 and calls sink for Escalate action', async () => {
    const { sink, calls } = makeSink()
    const handler = createOpsGenieAdapter({ sink, signingKey: SIGNING_KEY })
    const body = { action: 'Escalate', alert: { message: 'Escalated to on-call', priority: 'P1' } }
    const rawBody = JSON.stringify(body)
    const sig = computeHmacSha256Base64(SIGNING_KEY, rawBody)
    const res = await handler({ headers: { 'x-og-signature': sig }, rawBody })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})
