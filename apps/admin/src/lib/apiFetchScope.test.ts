/**
 * FILE: apps/admin/src/lib/apiFetchScope.test.ts
 * PURPOSE: Verify apiFetch scope option controls tenant headers.
 *
 * OVERVIEW:
 * - Exercises apiFetch() with the three `scope` modes and asserts which
 *   tenant headers (X-Mushi-Project-Id / X-Mushi-Org-Id) are attached.
 * - `project` (default): org + active project. `enumeration`: org only.
 *   `none`: neither.
 *
 * DEPENDENCIES:
 * - Mocks @supabase/supabase-js so getAccessToken() resolves instantly with a
 *   stub session (the real auth client uses navigator.locks/getSession which
 *   can hang in the test runtime and bleed a pending fetch into the next test).
 * - Mocks @sentry/react (apiFetch emits breadcrumbs on every request).
 * - Mocks activeProject/activeOrg snapshot accessors to deterministic ids.
 *
 * NOTES:
 * - apiFetch resolves the active project via getActiveProjectIdForApi (URL
 *   param wins over the localStorage snapshot); both are mocked so the project
 *   header resolves regardless of which accessor the implementation calls. The
 *   scope gating itself (project-only) is what the assertions exercise.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type * as ActiveProjectModule from './activeProject'
import type * as ActiveOrgModule from './activeOrg'

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

vi.mock('./activeProject', async (importOriginal) => {
  const actual = await importOriginal<typeof ActiveProjectModule>()
  return {
    ...actual,
    getActiveProjectIdSnapshot: () => '11111111-1111-4111-8111-111111111111',
    getActiveProjectIdForApi: () => '11111111-1111-4111-8111-111111111111',
  }
})

vi.mock('./activeOrg', async (importOriginal) => {
  const actual = await importOriginal<typeof ActiveOrgModule>()
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

/**
 * Headers of the request for `path`, not of whichever request happened to be
 * first. Reading `mock.calls[0]` made these tests order-dependent: a request
 * left in flight by a test that timed out resolves against the *next* test's
 * fetch mock, and its project header then failed the `none` assertion — a
 * leak that reads exactly like a real bug. Each test uses a distinct path, so
 * matching on it is deterministic no matter what else is in the queue.
 */
function headersFor(path: string): Record<string, string> {
  const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes(path))
  if (!call) throw new Error(`no fetch recorded for ${path}`)
  return (call[1]?.headers ?? {}) as Record<string, string>
}

describe('apiFetch scope headers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('project scope sends org and project headers by default', async () => {
    const { apiFetch } = await import('./supabase')
    await apiFetch('/v1/admin/reports')
    const headers = headersFor('/v1/admin/reports')
    expect(headers['X-Mushi-Project-Id']).toBeTruthy()
    expect(headers['X-Mushi-Org-Id']).toBeTruthy()
  })

  it('enumeration scope sends org header only', async () => {
    const { apiFetch } = await import('./supabase')
    await apiFetch('/v1/admin/projects', { scope: 'enumeration' })
    const headers = headersFor('/v1/admin/projects')
    expect(headers['X-Mushi-Project-Id']).toBeUndefined()
    expect(headers['X-Mushi-Org-Id']).toBeTruthy()
  })

  it('none scope sends neither tenant header', async () => {
    const { apiFetch } = await import('./supabase')
    await apiFetch('/v1/org', { scope: 'none' })
    const headers = headersFor('/v1/org')
    expect(headers['X-Mushi-Project-Id']).toBeUndefined()
    expect(headers['X-Mushi-Org-Id']).toBeUndefined()
  })
})
