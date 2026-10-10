/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/realtime.test.tsx
 * PURPOSE: useRealtime keeps one channel across re-renders with an inline
 *          callback, and still calls the latest callback.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rt = vi.hoisted(() => {
  const handlers: Array<() => void> = []
  const channel = vi.fn(() => {
    const ch = {
      on: (_t: unknown, _f: unknown, cb: () => void) => {
        handlers.push(cb)
        return ch
      },
      subscribe: () => ch,
    }
    return ch
  })
  return { handlers, channel, removeChannel: vi.fn() }
})
vi.mock('./supabase', () => ({ supabase: { channel: rt.channel, removeChannel: rt.removeChannel } }))

import { useRealtime } from './realtime'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function Harness({ onChange }: { onChange: () => void }) {
  useRealtime({ table: 'reports' }, () => onChange())
  return null
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  rt.handlers.length = 0
  rt.channel.mockClear()
  rt.removeChannel.mockClear()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useRealtime', () => {
  it('does not resubscribe when only the inline callback changes', () => {
    const first = vi.fn()
    const second = vi.fn()
    act(() => root.render(createElement(Harness, { onChange: first })))
    act(() => root.render(createElement(Harness, { onChange: second })))
    expect(rt.channel).toHaveBeenCalledTimes(1)
    expect(rt.removeChannel).not.toHaveBeenCalled()

    rt.handlers[0]()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })
})
