/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/PanelFetchNote.test.tsx
 * PURPOSE: A first panel failure is an alert. A failed refresh that still
 *          shows the last result is a status, so it is not announced as an alarm.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelFetchNote } from './PanelFetchNote'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('PanelFetchNote', () => {
  it('announces a first failure as an alert and a stale refresh as status', () => {
    const onRetry = vi.fn()
    act(() => {
      root.render(createElement(PanelFetchNote, { stale: true, onRetry }))
    })
    const stale = host.querySelector('p')
    expect(stale?.getAttribute('role')).toBe('status')
    expect(stale?.textContent).toContain("Couldn't refresh. Showing the last result.")
    expect(host.querySelector('[role="alert"]')).toBeNull()

    act(() => {
      root.render(createElement(PanelFetchNote, { message: "Couldn't load team activity.", onRetry }))
    })
    const hard = host.querySelector('p')
    expect(hard?.getAttribute('role')).toBe('alert')
    expect(hard?.textContent).toContain("Couldn't load team activity.")
    hard?.querySelector('button')?.click()
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
