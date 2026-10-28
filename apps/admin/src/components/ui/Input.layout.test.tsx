/**
 * @vitest-environment jsdom
 */

/**
 * Input put `className` on the <input>, but a flex row sizes the outer
 * <label>: Research's query box (`className="flex-1"`) stayed narrow at 1440
 * and cut off its own placeholder (2026-10-28). `containerClassName` styles
 * the label, `className` still the field.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Input } from './forms'

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

describe('Input layout classes', () => {
  it('puts containerClassName on the label a flex row sizes, className on the field', () => {
    act(() => {
      root.render(createElement(Input, { label: 'Web query', containerClassName: 'min-w-0 flex-1', className: 'font-mono', value: '', onChange: () => {} }))
    })
    const label = container.querySelector('label')!
    const input = container.querySelector('input')!
    expect(label.className).toContain('flex-1')
    expect(input.className).toContain('font-mono')
    expect(input.className).not.toContain('flex-1')
    expect(input.getAttribute('containerclassname')).toBeNull()
  })
})
