/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/useNavCounts.test.tsx
 * PURPOSE: The sidebar's counters cost ONE request per context. Layout and
 *          PipelineStatusRibbon used to mount two hook instances that each
 *          fired ~12 requests; the store now shares one nav-meta call, maps
 *          its `counts`, and only fans out per slice when the API build has
 *          no nav-meta route at all.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceNavMetaResponse } from './workspaceNavMetaResponse'
import type { NavCounts } from './useNavCounts'
import { EMPTY_NAV_STAT_SLICES } from './extendedNavMeta'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const fallback = vi.hoisted(() => ({ fetchNavSlicesFallback: vi.fn() }))
const entitlements = vi.hoisted(() => ({ isSuperAdmin: false, inventory: false }))

vi.mock('./supabase', () => ({ apiFetch: api.apiFetch }))
vi.mock('./realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('./useEntitlements', () => ({
  useEntitlements: () => ({
    isSuperAdmin: entitlements.isSuperAdmin,
    has: (flag: string) => flag === 'inventory_v2' && entitlements.inventory,
  }),
}))
vi.mock('./fetchNavSlicesFallback', () => ({ fetchNavSlicesFallback: fallback.fetchNavSlicesFallback }))

function navMeta(overrides: Partial<WorkspaceNavMetaResponse> = {}): WorkspaceNavMetaResponse {
  return {
    generatedAt: '2026-10-04T00:00:00Z',
    slices: {
      ...EMPTY_NAV_STAT_SLICES,
      dashboard: {
        openBacklog: 0,
        fixesFailed: 0,
        fixesInProgress: 0,
        integrationIssues: 2,
        topPriority: null,
      } as unknown as WorkspaceNavMetaResponse['slices']['dashboard'],
    },
    counts: {
      fixesInFlight: 1,
      fixesFailed: 2,
      prsOpen: 3,
      untriagedBacklog: 4,
      notificationsUnread: 5,
      queueFailed: 6,
      flaggedDevices: 7,
      feedbackWithReply: 8,
      judgeDisagreements: null,
      inboxOpenActions: 9,
      regressedActions: null,
      superAdminSignups7d: null,
      superAdminChurn30d: null,
    },
    projects: { projectCount: 3, neverIngestedCount: 1, staleKeyCount: 0 },
    members: null,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root
const seen: Record<string, NavCounts> = {}

/** Fresh module per test: the store is module-level by design. */
async function renderReaders(ids: string[]) {
  vi.resetModules()
  const { useNavCounts } = await import('./useNavCounts')
  function Reader({ id }: { id: string }) {
    seen[id] = useNavCounts(id === 'layout' ? { live: true } : {})
    return null
  }
  await act(async () => {
    root.render(createElement('div', null, ...ids.map((id) => createElement(Reader, { key: id, id }))))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  api.apiFetch.mockReset()
  fallback.fetchNavSlicesFallback.mockReset()
  entitlements.isSuperAdmin = false
  entitlements.inventory = false
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useNavCounts', () => {
  it('two readers share ONE nav-meta request that asks for the counters', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: navMeta() })
    await renderReaders(['layout', 'ribbon'])
    expect(api.apiFetch).toHaveBeenCalledTimes(1)
    expect(api.apiFetch.mock.calls[0][0]).toBe('/v1/admin/workspace/nav-meta?include=counts')
    expect(seen.layout.fixesFailed).toBe(2)
    expect(seen.ribbon.fixesFailed).toBe(2)
  })

  it('asks for inventory and super-admin numbers only when the user has them', async () => {
    entitlements.isSuperAdmin = true
    entitlements.inventory = true
    api.apiFetch.mockResolvedValue({ ok: true, data: navMeta() })
    await renderReaders(['layout'])
    expect(api.apiFetch.mock.calls[0][0]).toBe(
      '/v1/admin/workspace/nav-meta?include=counts%2Cinventory%2Csuperadmin',
    )
  })

  it('maps every counter, taking integration issues from the dashboard slice', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: navMeta() })
    await renderReaders(['layout'])
    expect(seen.layout).toMatchObject({
      fixesInFlight: 1,
      fixesFailed: 2,
      prsOpen: 3,
      untriagedBacklog: 4,
      notificationsUnread: 5,
      queueFailed: 6,
      flaggedDevices: 7,
      feedbackWithReply: 8,
      inboxOpenActions: 9,
      healthIssues: 2,
      projectCount: 3,
      projectsNeedingAttention: 1,
      // A failed counter renders no badge (0 with hideWhenZero).
      judgeDisagreements: 0,
      memberCount: null,
      ready: true,
    })
  })

  it('shows no counter badges from an older API without counts', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: navMeta({ counts: undefined }) })
    await renderReaders(['layout'])
    expect(seen.layout.fixesFailed).toBe(0)
    expect(seen.layout.untriagedBacklog).toBe(0)
    expect(seen.layout.healthIssues).toBe(2)
  })

  it('does not fan out per slice when nav-meta is down (5xx)', async () => {
    api.apiFetch.mockResolvedValue({ ok: false, error: { code: 'HTTP_ERROR', message: '503: unavailable' } })
    await renderReaders(['layout'])
    expect(api.apiFetch).toHaveBeenCalledTimes(1)
    expect(fallback.fetchNavSlicesFallback).not.toHaveBeenCalled()
    expect(seen.layout.ready).toBe(true)
  })

  it('falls back per slice only when the API has no nav-meta route (404)', async () => {
    api.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith('/v1/admin/workspace/nav-meta')
        ? { ok: false, error: { code: 'HTTP_ERROR', message: '404: 404 Not Found' } }
        : { ok: true, data: { projectCount: 2, neverIngestedCount: 0, staleKeyCount: 0 } },
    )
    fallback.fetchNavSlicesFallback.mockResolvedValue(EMPTY_NAV_STAT_SLICES)
    await renderReaders(['layout'])
    expect(fallback.fetchNavSlicesFallback).toHaveBeenCalledTimes(1)
    expect(seen.layout.projectCount).toBe(2)
  })
})
