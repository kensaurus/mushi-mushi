import { describe, it, expect } from 'vitest'
import { createRollbarAdapter, translateRollbar } from '../rollbar.js'
import { makeSink, makeReq } from './shared-hmac-fixtures.js'

const ACCESS_TOKEN = 'rollbar-access-token-xyz'

describe('translateRollbar', () => {
  it('maps new_item with error level to high severity', () => {
    const result = translateRollbar({
      event_name: 'new_item',
      data: { item: { id: 1, title: 'TypeError in server.js', level: 'error' } },
    })
    expect(result.description).toBe('TypeError in server.js')
    expect(result.category).toBe('bug')
    expect(result.severity).toBe('high')
    expect(result.source).toBe('rollbar')
    expect(result.metadata?.eventName).toBe('new_item')
  })

  it('maps critical level to critical severity', () => {
    const result = translateRollbar({
      event_name: 'new_item',
      data: { item: { level: 'critical', title: 'DB connection failed' } },
    })
    expect(result.severity).toBe('critical')
  })

  it('maps warning level to medium severity', () => {
    const result = translateRollbar({ data: { item: { level: 'warning', title: 'slow query' } } })
    expect(result.severity).toBe('medium')
  })

  it('maps info level to low severity', () => {
    const result = translateRollbar({ data: { item: { level: 'info', title: 'user login' } } })
    expect(result.severity).toBe('low')
  })

  it('maps debug level to low severity', () => {
    const result = translateRollbar({ data: { item: { level: 'debug', title: 'debug trace' } } })
    expect(result.severity).toBe('low')
  })

  it('maps reactivated_item event', () => {
    const result = translateRollbar({
      event_name: 'reactivated_item',
      data: { item: { title: 'Recurring error', level: 'error' } },
    })
    expect(result.metadata?.eventName).toBe('reactivated_item')
  })

  it('maps occurrence_rate_control event', () => {
    const result = translateRollbar({
      event_name: 'occurrence_rate_control',
      data: { item: { title: 'Rate exceeded', level: 'warning' } },
    })
    expect(result.metadata?.eventName).toBe('occurrence_rate_control')
  })

  it('extracts exception class from activating_occurrence', () => {
    const result = translateRollbar({
      event_name: 'new_item',
      data: {
        item: {
          activating_occurrence: {
            data: { body: { trace: { exception: { class: 'TypeError', message: 'undefined is not a function' } } } },
          },
        },
      },
    })
    expect(result.description).toContain('TypeError')
    expect(result.description).toContain('undefined is not a function')
  })

  it('uses projectName option', () => {
    const result = translateRollbar({ data: { item: {} } }, 'my-project')
    expect(result.component).toBe('my-project')
  })
})

describe('createRollbarAdapter', () => {
  it('returns 401 when access token header is missing', async () => {
    const { sink } = makeSink()
    const handler = createRollbarAdapter({ sink, accessToken: ACCESS_TOKEN })
    const res = await handler(makeReq({ event_name: 'new_item' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 for wrong access token', async () => {
    const { sink } = makeSink()
    const handler = createRollbarAdapter({ sink, accessToken: ACCESS_TOKEN })
    const res = await handler(makeReq(
      { event_name: 'new_item' },
      { 'x-rollbar-access-token': 'wrong-token' },
    ))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    const { sink } = makeSink()
    const handler = createRollbarAdapter({ sink, accessToken: ACCESS_TOKEN })
    const res = await handler({ headers: { 'x-rollbar-access-token': ACCESS_TOKEN }, rawBody: 'not-json' })
    expect(res.status).toBe(400)
  })

  it('returns 200 and calls sink for valid new_item', async () => {
    const { sink, calls } = makeSink()
    const handler = createRollbarAdapter({ sink, accessToken: ACCESS_TOKEN })
    const body = { event_name: 'new_item', data: { item: { title: 'Test error', level: 'error' } } }
    const res = await handler(makeReq(body, { 'x-rollbar-access-token': ACCESS_TOKEN }))
    expect(res.status).toBe(200)
    expect((res.body as { ok: boolean }).ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('returns 200 for reactivated_item', async () => {
    const { sink, calls } = makeSink()
    const handler = createRollbarAdapter({ sink, accessToken: ACCESS_TOKEN })
    const body = { event_name: 'reactivated_item', data: { item: { level: 'warning', title: 'Back again' } } }
    const res = await handler(makeReq(body, { 'x-rollbar-access-token': ACCESS_TOKEN }))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})
