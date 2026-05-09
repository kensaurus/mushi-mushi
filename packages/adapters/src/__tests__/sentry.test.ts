import { describe, it, expect } from 'vitest'
import { createSentryAdapter, translateSentry } from '../sentry.js'
import { makeSink, makeReq } from './shared-hmac-fixtures.js'

const SECRET = 'test-sentry-secret'

describe('translateSentry', () => {
  it('maps event.alert payload to bug with correct severity', () => {
    const result = translateSentry(
      { data: { event: { id: 'evt1', title: 'TypeError: foo', level: 'error', project: 'my-app' } } },
      'event.alert',
    )
    expect(result.description).toBe('TypeError: foo')
    expect(result.category).toBe('bug')
    expect(result.severity).toBe('high')
    expect(result.source).toBe('sentry')
    expect(result.component).toBe('my-app')
  })

  it('maps fatal level to critical severity', () => {
    const result = translateSentry(
      { data: { event: { level: 'fatal', title: 'OOM crash' } } },
      'event.alert',
    )
    expect(result.severity).toBe('critical')
  })

  it('maps issue.alert payload', () => {
    const result = translateSentry(
      { data: { issue: { id: 'iss1', title: 'NullPointerException', level: 'warning', project: { name: 'backend' } } } },
      'issue.alert',
    )
    expect(result.description).toBe('NullPointerException')
    expect(result.severity).toBe('medium')
    expect(result.component).toBe('backend')
  })

  it('maps metric_alert.open payload', () => {
    const result = translateSentry(
      { data: { metric_alert: { title: 'p99 latency > 500ms', alert_rule: { name: 'latency rule' } } } },
      'metric_alert.open',
    )
    expect(result.description).toBe('p99 latency > 500ms')
    expect(result.severity).toBe('high')
  })

  it('maps metric_alert.resolve to undefined severity', () => {
    const result = translateSentry(
      { data: { metric_alert: { title: 'latency resolved' } } },
      'metric_alert.resolve',
    )
    expect(result.severity).toBeUndefined()
  })

  it('uses projectName option over payload project', () => {
    const result = translateSentry(
      { data: { event: { project: 'payload-project' } } },
      'event.alert',
      'option-project',
    )
    expect(result.component).toBe('option-project')
  })
})

describe('createSentryAdapter', () => {
  it('returns 401 when secret header is missing', async () => {
    const { sink } = makeSink()
    const handler = createSentryAdapter({ sink, secret: SECRET })
    const res = await handler(makeReq({ data: {} }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when secret header is wrong', async () => {
    const { sink } = makeSink()
    const handler = createSentryAdapter({ sink, secret: SECRET })
    const res = await handler(makeReq({ data: {} }, { 'sentry-hook-secret': 'wrong-secret' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    const { sink } = makeSink()
    const handler = createSentryAdapter({ sink, secret: SECRET })
    const res = await handler({ headers: { 'sentry-hook-secret': SECRET }, rawBody: 'not-json' })
    expect(res.status).toBe(400)
  })

  it('returns 200 and calls sink for event.alert', async () => {
    const { sink, calls } = makeSink()
    const handler = createSentryAdapter({ sink, secret: SECRET })
    const body = { data: { event: { title: 'Test error', level: 'error' } } }
    const res = await handler(makeReq(body, {
      'sentry-hook-secret': SECRET,
      'sentry-hook-resource': 'event.alert',
    }))
    expect(res.status).toBe(200)
    expect((res.body as { ok: boolean }).ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('returns 200 and calls sink for issue.alert', async () => {
    const { sink, calls } = makeSink()
    const handler = createSentryAdapter({ sink, secret: SECRET })
    const body = { data: { issue: { title: 'Issue title', level: 'error' } } }
    const res = await handler(makeReq(body, {
      'sentry-hook-secret': SECRET,
      'sentry-hook-resource': 'issue.alert',
    }))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})
