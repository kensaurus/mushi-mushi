/**
 * @vitest-environment jsdom
 */

/**
 * FILE: CursorModelPicker.test.tsx
 * PURPOSE: Other mode must not stay open over a listed model after the
 *          saved spec changes from outside the picker, or after keyId changes.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CURSOR_MODEL_OTHER } from './cursorModelSpec'

const state = vi.hoisted(() => ({
  models: [{ id: 'grok-4.7', displayName: 'Grok 4.7' }] as Array<{ id: string; displayName: string }>,
}))

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { models: state.models }, loading: false, error: null, reload: () => {} }),
}))

import { CursorModelPicker } from './CursorModelPicker'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.models = [{ id: 'grok-4.7', displayName: 'Grok 4.7' }]
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(props: Partial<Parameters<typeof CursorModelPicker>[0]> & { value: string }) {
  act(() => {
    root.render(
      createElement(CursorModelPicker, {
        onChange: () => {},
        emptyLabel: 'Default',
        ...props,
      }),
    )
  })
}

const select = () => host.querySelector('select') as HTMLSelectElement
const modelIdInput = () => host.querySelector('input')

function pick(value: string) {
  const el = select()
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('CursorModelPicker Other mode', () => {
  it('closes Other when a listed model arrives from outside the picker', () => {
    const onChange = vi.fn()
    render({ value: '', onChange })
    act(() => pick(CURSOR_MODEL_OTHER))
    expect(modelIdInput()).toBeTruthy()
    render({ value: 'grok-4.7', onChange })
    expect(select().value).toBe('grok-4.7')
    expect(modelIdInput()).toBeNull()
  })

  it('keeps Other open when the picker itself clears the spec', () => {
    const onChange = vi.fn()
    render({ value: 'grok-4.7', onChange })
    act(() => pick(CURSOR_MODEL_OTHER))
    expect(onChange).toHaveBeenCalledWith('')
    render({ value: '', onChange })
    expect(select().value).toBe(CURSOR_MODEL_OTHER)
    expect(modelIdInput()).toBeTruthy()
  })

  it('closes Other when keyId changes onto a listed model', () => {
    const onChange = vi.fn()
    render({ value: 'grok-4.7', onChange, keyId: 'key-a' })
    act(() => pick(CURSOR_MODEL_OTHER))
    expect(modelIdInput()).toBeTruthy()
    render({ value: 'grok-4.7', onChange, keyId: 'key-b' })
    expect(select().value).toBe('grok-4.7')
    expect(modelIdInput()).toBeNull()
  })
})
