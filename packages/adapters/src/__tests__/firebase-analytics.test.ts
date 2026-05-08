import { describe, it, expect } from 'vitest'
import { createFirebaseAnalyticsAdapter, translateFirebaseAnalytics } from '../firebase-analytics.js'
import { makeSink, makeReq } from './shared-hmac-fixtures.js'

const PROJECT_ID = 'my-analytics-project'

/** Builds a minimal unsigned JWT-shaped token with the given `aud` claim. */
function makeJwt(aud: string | string[]): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: 'test', aud })).toString('base64url')
  return `${header}.${payload}.fakesig`
}

/** Base64-encodes a JSON object for use as a Pub/Sub message data field. */
function encodePubSubData(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
}

describe('translateFirebaseAnalytics', () => {
  it('maps user_engagement to confusing category', () => {
    const result = translateFirebaseAnalytics({ eventType: 'user_engagement', userId: 'u1' })
    expect(result.description).toContain('user_engagement')
    expect(result.category).toBe('confusing')
    expect(result.source).toBe('firebase-analytics')
    expect(result.metadata?.userId).toBe('u1')
  })

  it('maps purchase event', () => {
    const result = translateFirebaseAnalytics({ eventType: 'purchase', userId: 'u2' })
    expect(result.description).toContain('purchase')
    expect(result.category).toBe('confusing')
  })

  it('maps custom funnel event', () => {
    const result = translateFirebaseAnalytics({ eventType: 'checkout_step_abandoned', funnelStep: 3 })
    expect(result.description).toContain('checkout_step_abandoned')
    expect(result.metadata?.funnelStep).toBe(3)
  })

  it('uses eventName fallback when eventType is absent', () => {
    const result = translateFirebaseAnalytics({ eventName: 'add_to_cart' })
    expect(result.description).toContain('add_to_cart')
  })

  it('uses projectName option', () => {
    const result = translateFirebaseAnalytics({ eventType: 'purchase' }, 'my-project')
    expect(result.component).toBe('my-project')
  })
})

describe('createFirebaseAnalyticsAdapter', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const { sink } = makeSink()
    const handler = createFirebaseAnalyticsAdapter({ sink, projectId: PROJECT_ID })
    const data = encodePubSubData({ eventType: 'purchase' })
    const res = await handler(makeReq({ message: { data } }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when aud claim does not match project ID', async () => {
    const { sink } = makeSink()
    const handler = createFirebaseAnalyticsAdapter({ sink, projectId: PROJECT_ID })
    const token = makeJwt('other-project')
    const data = encodePubSubData({ eventType: 'purchase' })
    const res = await handler(makeReq({ message: { data } }, { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when outer JSON is malformed', async () => {
    const { sink } = makeSink()
    const handler = createFirebaseAnalyticsAdapter({ sink, projectId: PROJECT_ID })
    const token = makeJwt(PROJECT_ID)
    const res = await handler({ headers: { authorization: `Bearer ${token}` }, rawBody: 'bad-json' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when Pub/Sub message data is absent', async () => {
    const { sink } = makeSink()
    const handler = createFirebaseAnalyticsAdapter({ sink, projectId: PROJECT_ID })
    const token = makeJwt(PROJECT_ID)
    const res = await handler(makeReq({ message: {} }, { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when Pub/Sub data decodes to invalid JSON', async () => {
    const { sink } = makeSink()
    const handler = createFirebaseAnalyticsAdapter({ sink, projectId: PROJECT_ID })
    const token = makeJwt(PROJECT_ID)
    const data = Buffer.from('not-json').toString('base64')
    const res = await handler(makeReq({ message: { data } }, { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(400)
  })

  it('returns 200 and calls sink for valid user_engagement event', async () => {
    const { sink, calls } = makeSink()
    const handler = createFirebaseAnalyticsAdapter({ sink, projectId: PROJECT_ID })
    const token = makeJwt(PROJECT_ID)
    const data = encodePubSubData({ eventType: 'user_engagement', userId: 'u99' })
    const res = await handler(makeReq({ message: { data } }, { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(200)
    expect((res.body as { ok: boolean }).ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('accepts custom expectedAudience', async () => {
    const { sink, calls } = makeSink()
    const handler = createFirebaseAnalyticsAdapter({
      sink,
      projectId: PROJECT_ID,
      expectedAudience: 'https://webhook.example.com/analytics',
    })
    const token = makeJwt('https://webhook.example.com/analytics')
    const data = encodePubSubData({ eventType: 'purchase' })
    const res = await handler(makeReq({ message: { data } }, { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})
