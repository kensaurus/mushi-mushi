/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/usePageData.test.tsx
 * PURPOSE: A path swap is a new resource: the freshness stamp must not carry
 *          the previous path's time while the new one loads.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageDataState } from './usePageData'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('./supabase', () => ({ apiFetch: api.apiFetch }))
vi.mock('./activeProject', () => ({ useActiveProjectSignal: () => 'p1', useProjectDataEpoch: () => 0 }))
vi.mock('./activeOrg', () => ({ useActiveOrgSignal: () => 'o1' }))

import { usePageData } from './usePageData'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let latest: PageDataState<unknown> | null = null

function Harness({ path }: { path: string | null }) {
  latest = usePageData<unknown>(path)
  return null
}

async function render(path: string | null): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { path }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  api.apiFetch.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('usePageData', () => {
  it('clears lastFetchedAt when the path changes, until the new path loads', async () => {
    api.apiFetch.mockResolvedValueOnce({ ok: true, data: { a: 1 } })
    await render('/v1/a')
    expect(latest?.lastFetchedAt).not.toBeNull()

    api.apiFetch.mockReturnValueOnce(new Promise(() => {}))
    await render('/v1/b')
    expect(latest?.data).toBeNull()
    expect(latest?.lastFetchedAt).toBeNull()
  })

  // Releases switched to its New draft tab (path null) while the list was
  // loading; the aborted request left isValidating on and Refresh spun
  // forever (2026-10-28).
  it('stops validating when the path goes away mid-request', async () => {
    api.apiFetch.mockReturnValueOnce(new Promise(() => {}))
    await render('/v1/releases')
    expect(latest?.isValidating).toBe(true)
    await render(null)
    expect(latest?.isValidating).toBe(false)
    expect(latest?.loading).toBe(false)
  })
})
