/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/usePageData.lastGood.test.tsx
 * PURPOSE: A page visited before opens on its last good answer (no skeleton)
 *          and refreshes it in the background; a page never loaded still
 *          shows the skeleton.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageDataState } from './usePageData'
import { clearLastGood, registerLastGoodKey, rememberLastGood } from './lastGoodCache'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('./supabase', () => ({ apiFetch: api.apiFetch }))
vi.mock('./activeProject', () => ({ useActiveProjectSignal: () => 'p1', useProjectDataEpoch: () => 0 }))
vi.mock('./activeOrg', () => ({ useActiveOrgSignal: () => 'o1' }))

import { usePageData } from './usePageData'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const seen: Array<PageDataState<unknown>> = []

function Harness({ path }: { path: string }) {
  seen.push(usePageData<unknown>(path))
  return null
}

async function render(path: string): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { path }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  api.apiFetch.mockReset()
  seen.length = 0
  clearLastGood()
  registerLastGoodKey((path, scope) => `GET:${scope}:${path}`)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('usePageData last good answer', () => {
  it('paints the cached answer on the first render, then refreshes it', async () => {
    rememberLastGood('GET:project:/v1/admin/dashboard', { cards: 1 })
    let resolve!: (v: unknown) => void
    api.apiFetch.mockReturnValueOnce(new Promise((r) => (resolve = r)))

    await render('/v1/admin/dashboard')
    expect(seen[0]?.data).toEqual({ cards: 1 })
    expect(seen[0]?.loading).toBe(false)
    expect(seen.at(-1)?.isValidating).toBe(true)

    await act(async () => resolve({ ok: true, data: { cards: 2 } }))
    expect(seen.at(-1)?.data).toEqual({ cards: 2 })
    expect(seen.at(-1)?.isValidating).toBe(false)
  })

  it('still shows the skeleton for a page with no cached answer', async () => {
    api.apiFetch.mockReturnValueOnce(new Promise(() => {}))
    await render('/v1/admin/inbox/stats')
    expect(seen[0]?.data).toBeNull()
    expect(seen[0]?.loading).toBe(true)
  })

  it('swaps to the cached answer for the new path on a path change', async () => {
    rememberLastGood('GET:project:/v1/b', { b: true })
    api.apiFetch.mockResolvedValueOnce({ ok: true, data: { a: true } })
    await render('/v1/a')
    api.apiFetch.mockReturnValueOnce(new Promise(() => {}))
    await render('/v1/b')
    expect(seen.at(-1)?.data).toEqual({ b: true })
    expect(seen.at(-1)?.loading).toBe(false)
  })
})
