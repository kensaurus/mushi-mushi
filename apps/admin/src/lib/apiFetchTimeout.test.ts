/**
 * FILE: apps/admin/src/lib/apiFetchTimeout.test.ts
 * PURPOSE: A console read gets a deadline; a write does not. A read past the
 *          deadline answers TIMEOUT and is not reported to Sentry as an
 *          exception (it is slowness, not a reachability bug).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as Sentry from '@sentry/react'

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: 'test-token', expires_at: 9_999_999_999 } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}))

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

vi.mock('./env', () => ({
  RESOLVED_API_URL: 'https://api.test',
  RESOLVED_SUPABASE_URL: 'https://supabase.test',
  RESOLVED_SUPABASE_ANON_KEY: 'anon',
}))

function signalFor(path: string): AbortSignal | undefined {
  const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes(path))
  if (!call) throw new Error(`no fetch recorded for ${path}`)
  return (call[1] as RequestInit | undefined)?.signal ?? undefined
}

describe('apiFetch deadline', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('gives a GET a timeout signal and leaves a POST without one', async () => {
    const { apiFetch } = await import('./supabase')
    await apiFetch('/v1/admin/timeout-get')
    await apiFetch('/v1/admin/timeout-post', { method: 'POST', body: '{}' })
    expect(signalFor('/v1/admin/timeout-get')).toBeInstanceOf(AbortSignal)
    expect(signalFor('/v1/admin/timeout-post')).toBeUndefined()
  })

  it("keeps the caller's own signal", async () => {
    const { apiFetch } = await import('./supabase')
    const own = new AbortController().signal
    await apiFetch('/v1/admin/timeout-own', { signal: own })
    expect(signalFor('/v1/admin/timeout-own')).toBe(own)
  })

  it('answers TIMEOUT for a read past the deadline, without a Sentry exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }),
    )
    const { apiFetch } = await import('./supabase')
    const res = await apiFetch('/v1/admin/timeout-slow')
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('TIMEOUT')
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled()
  })
})
