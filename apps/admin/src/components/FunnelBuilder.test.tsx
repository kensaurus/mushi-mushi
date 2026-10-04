/**
 * @vitest-environment jsdom
 */

/**
 * QA 291: loading a saved funnel and pressing Save renamed it to whatever the
 * name field last held, because the field never followed the loaded funnel.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FunnelBuilder } from './FunnelBuilder'
import type { FunnelDefinition } from '../lib/funnelBuilder'

const A: FunnelDefinition = { id: 'a', name: 'Checkout', steps: ['signup_click', 'signup_completed'], window: '7d', breakdown: null }
const B: FunnelDefinition = { id: 'b', name: 'Activation', steps: ['signup_completed', 'key_minted'], window: '7d', breakdown: null }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(value: FunnelDefinition, onSave: (d: FunnelDefinition) => void) {
  act(() => {
    root.render(
      createElement(FunnelBuilder, {
        value,
        onChange: vi.fn(),
        onRun: vi.fn(),
        availableEvents: [],
        saved: [A, B],
        onSave,
        onLoad: vi.fn(),
        onDelete: vi.fn(),
      }),
    )
  })
}

describe('FunnelBuilder save name', () => {
  it('saves a loaded funnel under its own name', () => {
    const onSave = vi.fn()
    render(A, onSave)
    render(B, onSave)
    const input = container.querySelector<HTMLInputElement>('#funnel-save-name')
    expect(input?.value).toBe('Activation')
    const save = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save')
    act(() => save?.click())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', name: 'Activation' }))
  })
})
