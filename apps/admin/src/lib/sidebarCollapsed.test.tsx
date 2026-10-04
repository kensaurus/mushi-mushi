/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSidebarCollapsed } from './sidebarCollapsed'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
const latest: { value: boolean; set: (next: boolean) => void } = { value: true, set: () => {} }

function Probe() {
  const [value, set] = useSidebarCollapsed()
  latest.value = value
  latest.set = set
  return null
}

function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<Probe />))
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

describe('useSidebarCollapsed', () => {
  it('defaults to collapsed', () => {
    mount()
    expect(latest.value).toBe(true)
    expect(document.documentElement.dataset.sidebar).toBe('collapsed')
  })

  it('keeps an expanded choice saved under the old key', () => {
    window.localStorage.setItem('mushi:sidebarCollapsed:v1', '0')
    mount()
    expect(latest.value).toBe(false)
  })

  it('remembers a change under the namespaced key', () => {
    mount()
    act(() => latest.set(false))
    expect(window.localStorage.getItem('mushi:ui:sidebar-collapsed')).toBe('{"v":1,"value":false}')
    expect(document.documentElement.dataset.sidebar).toBe('expanded')
  })
})
