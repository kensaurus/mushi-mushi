/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  persistentStorageKey,
  readPersistentValue,
  usePersistentState,
  writePersistentValue,
} from './usePersistentState'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
})

beforeEach(() => {
  window.localStorage.clear()
})

type Setter<T> = (next: T | ((current: T) => T)) => void

function mountHook<T>(
  key: string,
  initial: T,
  opts: { projectId?: string | null; version?: number; validate?: (v: unknown) => v is T } = {},
) {
  const latest: { value: T; set: Setter<T> } = { value: initial, set: () => {} }
  let props = opts
  function Probe() {
    const [value, set] = usePersistentState(key, initial, props)
    latest.value = value
    latest.set = set
    return null
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<Probe />))
  return {
    latest,
    rerender(next: typeof opts) {
      props = next
      act(() => root!.render(<Probe />))
    },
  }
}

describe('persistentStorageKey', () => {
  it('namespaces per project and globally', () => {
    expect(persistentStorageKey('settings:tab', 'p1')).toBe('mushi:ui:p1:settings:tab')
    expect(persistentStorageKey('sidebar')).toBe('mushi:ui:sidebar')
  })
})

describe('usePersistentState', () => {
  it('starts from the default and remembers a change across mounts', () => {
    const first = mountHook('settings:tab', 'general', { projectId: 'p1' })
    expect(first.latest.value).toBe('general')
    act(() => first.latest.set('byok'))
    expect(first.latest.value).toBe('byok')
    expect(window.localStorage.getItem('mushi:ui:p1:settings:tab')).toBe('{"v":1,"value":"byok"}')

    act(() => root?.unmount())
    const second = mountHook('settings:tab', 'general', { projectId: 'p1' })
    expect(second.latest.value).toBe('byok')
  })

  it('keeps each project separate and re-reads when the project changes', () => {
    writePersistentValue('mushi:ui:p2:settings:tab', 'health')
    const hook = mountHook('settings:tab', 'general', { projectId: 'p1' })
    act(() => hook.latest.set('voice'))
    hook.rerender({ projectId: 'p2' })
    expect(hook.latest.value).toBe('health')
    hook.rerender({ projectId: 'p1' })
    expect(hook.latest.value).toBe('voice')
  })

  it('ignores a value stored under another version', () => {
    window.localStorage.setItem('mushi:ui:filters', JSON.stringify({ v: 1, value: ['old-shape'] }))
    const hook = mountHook<{ status: string }>('filters', { status: 'open' }, { version: 2 })
    expect(hook.latest.value).toEqual({ status: 'open' })
  })

  it('falls back to the default when a stored value fails validation', () => {
    writePersistentValue('mushi:ui:settings:tab', 'removed-tab')
    const isTab = (v: unknown): v is string => v === 'general' || v === 'byok'
    const hook = mountHook('settings:tab', 'general', { validate: isTab })
    expect(hook.latest.value).toBe('general')
  })

  it('uses the default when storage throws, and still updates in memory', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const hook = mountHook('open', false)
    expect(hook.latest.value).toBe(false)
    act(() => hook.latest.set((v) => !v))
    expect(hook.latest.value).toBe(true)
  })

  it('treats corrupt JSON as no value', () => {
    window.localStorage.setItem('mushi:ui:open', '{not json')
    expect(readPersistentValue('mushi:ui:open', true)).toBe(true)
  })
})
