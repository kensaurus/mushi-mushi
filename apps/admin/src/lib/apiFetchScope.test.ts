/**
 * FILE: apps/admin/src/lib/apiFetchScope.test.ts
 * PURPOSE: Verify apiFetch scope option controls tenant headers.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type * as ActiveProjectModule from './activeProject'
import type * as ActiveOrgModule from './activeOrg'

vi.mock('./activeProject', async (importOriginal) => {
  const actual = await importOriginal<ActiveProjectModule>()
  return {
    ...actual,
    getActiveProjectIdSnapshot: () => '11111111-1111-4111-8111-111111111111',
  }
})

vi.mock('./activeOrg', async (importOriginal) => {
  const actual = await importOriginal<ActiveOrgModule>()
  return {
    ...actual,
    getActiveOrgIdSnapshot: () => '22222222-2222-4222-8222-222222222222',
  }
})

vi.mock('./env', () => ({
  RESOLVED_API_URL: 'https://api.test',
  RESOLVED_SUPABASE_URL: 'https://supabase.test',
  RESOLVED_SUPABASE_ANON_KEY: 'anon',
}))

describe('apiFetch scope headers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('project scope sends org and project headers by default', async () => {
    const { apiFetch } = await import('./supabase')
    await apiFetch('/v1/admin/reports')
    const fetchMock = vi.mocked(fetch)
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers['X-Mushi-Project-Id']).toBeTruthy()
    expect(headers['X-Mushi-Org-Id']).toBeTruthy()
  })

  it('enumeration scope sends org header only', async () => {
    vi.resetModules()
    const { apiFetch } = await import('./supabase')
    await apiFetch('/v1/admin/projects', { scope: 'enumeration' })
    const fetchMock = vi.mocked(fetch)
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers['X-Mushi-Project-Id']).toBeUndefined()
    expect(headers['X-Mushi-Org-Id']).toBeTruthy()
  })

  it('none scope sends neither tenant header', async () => {
    vi.resetModules()
    const { apiFetch } = await import('./supabase')
    await apiFetch('/v1/org', { scope: 'none' })
    const fetchMock = vi.mocked(fetch)
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers['X-Mushi-Project-Id']).toBeUndefined()
    expect(headers['X-Mushi-Org-Id']).toBeUndefined()
  })
})
