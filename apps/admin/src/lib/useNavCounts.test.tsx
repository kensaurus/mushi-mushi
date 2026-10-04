/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/useNavCounts.test.tsx
 * PURPOSE: The sidebar's counters cost ONE request per context. Layout and
 *          PipelineStatusRibbon used to mount two hook instances that each
 *          fired ~12 requests; the store now shares one nav-meta call, maps
 *          its `counts` without inventing zeros' meaning, and only fans out
 *          per slice when the API build has no nav-meta route at all.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceNavMetaResponse } from './workspaceNavMetaResponse'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const fallback = vi.hoisted(() => ({ fetchNavSlicesFallback: vi.fn() }))

vi.mock('./supabase', () => ({ apiFetch: api.apiFetch }))
vi.mock('./realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('./useEntitlements', () => ({ useEntitlements: () => ({ isSuperAdmin: false, has: () => false }) }))
vi.mock('./fetchNavSlicesFallback', () => ({ fetchNavSlicesFallback: fallback.fetchNavSlicesFallback }))

import {
  navCountsFromNavMeta,
  navMetaPath,
  resetNavCountsStore,
  useNavCounts,
  type NavCounts,
} from './useNavCounts'
import { EMPTY_NAV_STAT_SLICES } from './extendedNavMeta'

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

function Reader({ id }: { id: string }) {
  seen[id] = useNavCounts(id === 'layout' ? { live: true } : {})
  return null
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  api.apiFetch.mockReset()
  fallback.fetchNavSlicesFallback.mockReset()
  resetNavCountsStore()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('navMetaPath', () => {
  it('always asks for counts and only adds gated parts when allowed', () => {
    expect(navMetaPath({ inventoryEnabled: false, isSuperAdmin: false, fresh: false })).toBe(
      '/v1/admin/workspace/nav-meta?include=counts',
    )
    expect(navMetaPath({ inventoryEnabled: true, isSuperAdmin: true, fresh: true })).toBe(
      '/v1/admin/workspace/nav-meta?include=counts%2Cinventory%2Csuperadmin&fresh=1',
    )
  })
})

describe('navCountsFromNavMeta', () => {
  it('maps every counter and takes integration issues from the dashboard slice', () => {
    const c = navCountsFromNavMeta(navMeta())
    expect(c).toMatchObject({
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
      ready: true,
    })
    // A failed counter shows no badge (0 with hideWhenZero), not a number.
    expect(c.judgeDisagreements).toBe(0)
    expect(c.memberCount).toBeNull()
  })

  it('treats an older API without counts as no badges', () => {
    const c = navCountsFromNavMeta(navMeta({ counts: undefined }))
    expect(c.fixesFailed).toBe(0)
    expect(c.untriagedBacklog).toBe(0)
    expect(c.healthIssues).toBe(2)
  })
})

describe('useNavCounts store', () => {
  it('two readers share one nav-meta request', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: navMeta() })
    await act(async () => {
      root.render(
        createElement('div', null, createElement(Reader, { id: 'layout' }), createElement(Reader, { id: 'ribbon' })),
      )
    })
    expect(api.apiFetch).toHaveBeenCalledTimes(1)
    expect(api.apiFetch.mock.calls[0][0]).toBe('/v1/admin/workspace/nav-meta?include=counts')
    expect(seen.layout.fixesFailed).toBe(2)
    expect(seen.ribbon.fixesFailed).toBe(2)
  })

  it('does not fan out per slice when nav-meta is down (5xx)', async () => {
    api.apiFetch.mockResolvedValue({ ok: false, error: { code: 'HTTP_ERROR', message: '503: unavailable' } })
    await act(async () => {
      root.render(createElement(Reader, { id: 'layout' }))
    })
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
    await act(async () => {
      root.render(createElement(Reader, { id: 'layout' }))
    })
    expect(fallback.fetchNavSlicesFallback).toHaveBeenCalledTimes(1)
    expect(seen.layout.projectCount).toBe(2)
  })
})
