/**
 * FILE: apps/admin/src/lib/apiFetchActiveProject.test.ts
 * PURPOSE: Guard the ProjectSwitcher -> API boundary. Unscoped admin endpoints
 *          such as `/v1/admin/settings` depend on the API client carrying the
 *          active project id, and GET micro-cache keys must not leak one
 *          project's response into another after switching projects.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(() =>
    Promise.resolve({
      data: { session: { access_token: 'test-token', expires_at: 9_999_999_999 } },
    }),
  ),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: mocks.getSession,
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
  RESOLVED_SUPABASE_URL: 'http://supabase.local',
  RESOLVED_SUPABASE_ANON_KEY: 'anon',
  RESOLVED_API_URL: 'http://api.local',
}))

import { setActiveProjectIdSnapshot } from './activeProject'
import { apiFetch, invalidateApiCache } from './supabase'

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestInitAt(fetchMock: ReturnType<typeof vi.fn>, index: number): RequestInit {
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
  const init = calls[index]?.[1]
  expect(init).toBeDefined()
  return init
}

describe('apiFetch active project scoping', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
    invalidateApiCache()
  })

  it('sends the active project id header', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ settings: true }))
    vi.stubGlobal('fetch', fetchMock)

    setActiveProjectIdSnapshot('11111111-1111-4111-8111-111111111111')
    await apiFetch('/v1/admin/settings')

    const init = requestInitAt(fetchMock, 0)
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'X-Mushi-Project-Id': '11111111-1111-4111-8111-111111111111',
    })
  })

  it('keys GET coalescing by active project id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ project: 'one' }))
      .mockResolvedValueOnce(jsonResponse({ project: 'two' }))
    vi.stubGlobal('fetch', fetchMock)

    setActiveProjectIdSnapshot('11111111-1111-4111-8111-111111111111')
    await apiFetch('/v1/admin/settings')

    setActiveProjectIdSnapshot('22222222-2222-4222-8222-222222222222')
    await apiFetch('/v1/admin/settings')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requestInitAt(fetchMock, 0).headers).toMatchObject({
      'X-Mushi-Project-Id': '11111111-1111-4111-8111-111111111111',
    })
    expect(requestInitAt(fetchMock, 1).headers).toMatchObject({
      'X-Mushi-Project-Id': '22222222-2222-4222-8222-222222222222',
    })
  })
})
