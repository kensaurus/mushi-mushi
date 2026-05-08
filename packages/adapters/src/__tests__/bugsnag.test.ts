import { describe, it, expect } from 'vitest'
import { createBugsnagAdapter, translateBugsnag } from '../bugsnag.js'
import { computeHmacSha256Hex, makeSink, makeReq } from './shared-hmac-fixtures.js'

const API_KEY = 'bugsnag-api-key-abc123'

describe('translateBugsnag', () => {
  it('maps errorOccurred with error severity to high', () => {
    const result = translateBugsnag({
      trigger: { type: 'errorOccurred' },
      project: { name: 'my-app' },
      error: { errorClass: 'RangeError', message: 'out of bounds', severity: 'error' },
    })
    expect(result.description).toBe('RangeError: out of bounds')
    expect(result.category).toBe('bug')
    expect(result.severity).toBe('high')
    expect(result.source).toBe('bugsnag')
    expect(result.component).toBe('my-app')
  })

  it('maps warning severity to medium', () => {
    const result = translateBugsnag({
      error: { severity: 'warning', message: 'deprecated call' },
    })
    expect(result.severity).toBe('medium')
  })

  it('maps info severity to low', () => {
    const result = translateBugsnag({ error: { severity: 'info', message: 'handled error' } })
    expect(result.severity).toBe('low')
  })

  it('falls back to trigger message when no error', () => {
    const result = translateBugsnag({ trigger: { type: 'errorSpiked', message: 'spike detected' } })
    expect(result.description).toBe('spike detected')
  })

  it('uses projectName option over project.name', () => {
    const result = translateBugsnag({ project: { name: 'payload-project' } }, 'option-project')
    expect(result.component).toBe('option-project')
  })

  it('stores metadata correctly', () => {
    const result = translateBugsnag({
      trigger: { type: 'errorRecurring' },
      project: { id: 'proj1' },
      error: { id: 'err1', errorClass: 'TypeError', context: '/api/users', url: 'https://app.bugsnag.com/errors/err1' },
    })
    expect(result.metadata?.errorId).toBe('err1')
    expect(result.metadata?.context).toBe('/api/users')
    expect(result.metadata?.triggerType).toBe('errorRecurring')
  })
})

describe('createBugsnagAdapter', () => {
  it('returns 401 when signature header is missing', async () => {
    const { sink } = makeSink()
    const handler = createBugsnagAdapter({ sink, apiKey: API_KEY })
    const res = await handler(makeReq({ trigger: {} }))
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid HMAC signature', async () => {
    const { sink } = makeSink()
    const handler = createBugsnagAdapter({ sink, apiKey: API_KEY })
    const res = await handler(makeReq({ trigger: {} }, { 'x-bugsnag-signature': 'badhex' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    const { sink } = makeSink()
    const handler = createBugsnagAdapter({ sink, apiKey: API_KEY })
    const rawBody = 'not-json'
    const sig = computeHmacSha256Hex(API_KEY, rawBody)
    const res = await handler({ headers: { 'x-bugsnag-signature': sig }, rawBody })
    expect(res.status).toBe(400)
  })

  it('returns 200 and calls sink for valid errorOccurred', async () => {
    const { sink, calls } = makeSink()
    const handler = createBugsnagAdapter({ sink, apiKey: API_KEY })
    const body = { trigger: { type: 'errorOccurred' }, error: { severity: 'error', message: 'crash' } }
    const rawBody = JSON.stringify(body)
    const sig = computeHmacSha256Hex(API_KEY, rawBody)
    const res = await handler({ headers: { 'x-bugsnag-signature': sig }, rawBody })
    expect(res.status).toBe(200)
    expect((res.body as { ok: boolean }).ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('returns 200 and calls sink for errorRecurring', async () => {
    const { sink, calls } = makeSink()
    const handler = createBugsnagAdapter({ sink, apiKey: API_KEY })
    const body = { trigger: { type: 'errorRecurring' }, error: { severity: 'warning', message: 'recurred' } }
    const rawBody = JSON.stringify(body)
    const sig = computeHmacSha256Hex(API_KEY, rawBody)
    const res = await handler({ headers: { 'x-bugsnag-signature': sig }, rawBody })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('returns 200 and calls sink for errorSpiked', async () => {
    const { sink, calls } = makeSink()
    const handler = createBugsnagAdapter({ sink, apiKey: API_KEY })
    const body = { trigger: { type: 'errorSpiked', rate: 42 }, error: { severity: 'error' } }
    const rawBody = JSON.stringify(body)
    const sig = computeHmacSha256Hex(API_KEY, rawBody)
    const res = await handler({ headers: { 'x-bugsnag-signature': sig }, rawBody })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})
