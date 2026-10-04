/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/useTesterStatus.test.tsx
 * PURPOSE: Group K entries 60 and 318 — every mounted useTesterStatus() sees a
 *          refresh. The portal gate, the header balance pill and the enroll
 *          form each own an instance; reloading only one left the others stale
 *          (activation form stayed after enrolling, old balance in the header).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidateApiCache: vi.fn(), enrolled: false, balance: 0 }))

vi.mock('./supabase', () => ({
  apiFetch: api.apiFetch,
  invalidateApiCache: api.invalidateApiCache,
}))

import { refreshTesterStatus, useTesterStatus } from './useTesterStatus'

type Seen = { isTester: boolean; balance: number } | null
const seen: Record<string, Seen> = {}
let enrollFn: (() => Promise<boolean>) | null = null

function Probe({ name }: { name: string }) {
  const { data, enroll } = useTesterStatus()
  seen[name] = data ? { isTester: data.isTester, balance: data.balance } : null
  if (name === 'form') enrollFn = () => enroll({ acceptedTerms: true })
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  api.enrolled = false
  api.balance = 0
  api.apiFetch.mockReset()
  api.apiFetch.mockImplementation(async (path: string) => {
    if (path === '/v1/tester/enroll') {
      api.enrolled = true
      return { ok: true, data: { enrolled: true, created: true } }
    }
    return { ok: true, data: { isTester: api.enrolled, balance: api.balance } }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function renderTwo(): Promise<void> {
  await act(async () => {
    root.render(createElement('div', null, createElement(Probe, { name: 'gate' }), createElement(Probe, { name: 'form' })))
  })
  await flush()
}

describe('useTesterStatus shared refresh', () => {
  it('enrolling from one instance updates every instance', async () => {
    await renderTwo()
    expect(seen.gate?.isTester).toBe(false)

    await act(async () => {
      await enrollFn!()
    })
    await flush()

    expect(seen.gate?.isTester).toBe(true)
    expect(seen.form?.isTester).toBe(true)
    expect(api.invalidateApiCache).toHaveBeenCalledWith('/v1/me/tester-status')
  })

  it('refreshTesterStatus() moves a stale balance pill', async () => {
    api.enrolled = true
    api.balance = 500
    await renderTwo()
    expect(seen.gate?.balance).toBe(500)

    api.balance = 0 // redeemed elsewhere
    await act(async () => refreshTesterStatus())
    await flush()

    expect(seen.gate?.balance).toBe(0)
    expect(seen.form?.balance).toBe(0)
  })
})
