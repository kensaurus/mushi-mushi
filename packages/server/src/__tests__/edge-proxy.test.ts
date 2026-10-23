/**
 * FILE: edge-proxy.test.ts
 * PURPOSE: `api` forwards CI runner, inventory and Ask Mushi paths to
 *          `api-ext` (deploy size limit, 2026-10-21). The forward must keep
 *          the caller's auth headers, method, query and body, drop hop-by-hop
 *          headers, and hand back a response whose headers `api`'s CORS
 *          middleware can still set.
 */

import { describe, expect, it } from 'vitest'
import { proxyTargetUrl, proxyToFunction } from '../../supabase/functions/_shared/edge-proxy.ts'

const SUPABASE = 'https://ref.supabase.co'

describe('proxyTargetUrl', () => {
  it('maps an api path onto the other function, keeping the query', () => {
    expect(proxyTargetUrl(`${SUPABASE}/`, 'api-ext', '/v1/admin/ci/overview', '?refresh=1')).toBe(
      `${SUPABASE}/functions/v1/api-ext/v1/admin/ci/overview?refresh=1`,
    )
  })

  it('refuses anything but a /v1/ path and a plain function name', () => {
    expect(() => proxyTargetUrl(SUPABASE, 'api-ext', '/../admin', '')).toThrow(/only \/v1\//)
    expect(() => proxyTargetUrl(SUPABASE, '../api', '/v1/x', '')).toThrow(/bad function name/)
  })
})

describe('proxyToFunction', () => {
  it('forwards method, auth headers and body, and returns mutable headers', async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.url = url
      seen.init = init
      return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } })
    }) as unknown as typeof fetch
    const req = new Request('https://ref.supabase.co/functions/v1/api/v1/ingest/runner?x=1', {
      method: 'POST',
      headers: { 'X-Mushi-Api-Key': 'mushi_test', Authorization: 'Bearer jwt', Host: 'ref.supabase.co', 'Content-Type': 'application/json' },
      body: '{"kind":"job"}',
    })
    const res = await proxyToFunction(req, 'api-ext', '/v1/ingest/runner', { supabaseUrl: SUPABASE, fetchImpl })

    expect(seen.url).toBe(`${SUPABASE}/functions/v1/api-ext/v1/ingest/runner?x=1`)
    expect(seen.init?.method).toBe('POST')
    const sent = seen.init?.headers as Headers
    expect(sent.get('x-mushi-api-key')).toBe('mushi_test')
    expect(sent.get('authorization')).toBe('Bearer jwt')
    expect(sent.get('host')).toBeNull()
    expect(sent.get('x-mushi-forwarded-by')).toBe('api')
    expect(await new Response(seen.init?.body as BodyInit).text()).toBe('{"kind":"job"}')

    expect(res.status).toBe(201)
    expect(res.headers.get('transfer-encoding')).toBeNull()
    res.headers.set('access-control-allow-origin', 'https://kensaur.us')
    expect(res.headers.get('access-control-allow-origin')).toBe('https://kensaur.us')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('sends no body for GET', async () => {
    let body: unknown = 'unset'
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = init.body
      return new Response('[]')
    }) as unknown as typeof fetch
    await proxyToFunction(new Request(`${SUPABASE}/functions/v1/api/v1/admin/inventory/stats`), 'api-ext', '/v1/admin/inventory/stats', { supabaseUrl: SUPABASE, fetchImpl })
    expect(body).toBeUndefined()
  })
})
