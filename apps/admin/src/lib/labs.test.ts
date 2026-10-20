/**
 * Labs: per-feature sidebar opt-in (console audit 2026-10-20, Phase 1).
 * State is reached the way the app reaches it, through `useLabs()`.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabFeature } from './labs'
import type * as Labs from './labs'

const KEY = 'mushi:labs'

type LabsModule = typeof Labs
type Hook = ReturnType<LabsModule['useLabs']>

let mod: LabsModule
let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: Hook | null = null

function Probe() {
  latest = mod.useLabs()
  return null
}

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(Probe))
  })
}

function stored(): unknown {
  const raw = window.localStorage.getItem(KEY)
  return raw ? JSON.parse(raw) : null
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  vi.resetModules()
  mod = await import('./labs')
  latest = null
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('useLabs', () => {
  it('persists an enabled Lab to localStorage and reads it back', async () => {
    await mount()
    expect(latest!.isEnabled('bug-clusters')).toBe(false)
    await act(async () => latest!.setEnabled('bug-clusters', true))
    expect(latest!.isEnabled('bug-clusters')).toBe(true)
    expect(stored()).toEqual(['bug-clusters'])
  })

  it('removes a disabled Lab from localStorage', async () => {
    await mount()
    await act(async () => {
      latest!.setEnabled('bug-clusters', true)
      latest!.setEnabled('to-do', true)
      latest!.setEnabled('bug-clusters', false)
    })
    expect(latest!.isEnabled('bug-clusters')).toBe(false)
    expect(stored()).toEqual(['to-do'])
  })

  it('ignores ids that are not in the registry', async () => {
    await mount()
    await act(async () => latest!.setEnabled('not-a-lab', true))
    expect(latest!.enabled.size).toBe(0)
    expect(stored()).toBeNull()
  })

  it('drops unknown ids already in storage when reading', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(['bug-clusters', 'ghost', 42]))
    await mount()
    expect([...latest!.enabled]).toEqual(['bug-clusters'])
  })
})

describe('labForPath', () => {
  it('matches the route and its sub-routes', () => {
    expect(mod.labForPath('/graph')?.id).toBe('bug-clusters')
    expect(mod.labForPath('/graph/x')?.id).toBe('bug-clusters')
  })

  it('does not match a route that only shares a prefix, or a core page', () => {
    expect(mod.labForPath('/graphql')).toBeNull()
    expect(mod.labForPath('/reports')).toBeNull()
  })

  it('resolves every registered first path to its own Lab', () => {
    for (const f of mod.LAB_FEATURES as readonly LabFeature[]) expect(mod.labForPath(f.paths[0])?.id).toBe(f.id)
  })
})
