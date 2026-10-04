/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/StatusStepper.test.tsx
 * PURPOSE: The stepper's segments must be able to grow.
 *
 * Why (2026-10-04 console audit): every bar rendered 0 px wide. Tooltip
 * wraps its child in an `inline-flex` span, and that span — not the
 * segment — is the flex item, so it needs the flex sizing.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StatusStepper } from './StatusStepper'

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

describe('StatusStepper', () => {
  it.each(['table', 'compact', 'full'] as const)('gives every segment wrapper flex-1 (%s)', (size) => {
    act(() => root.render(createElement(StatusStepper, { status: 'fixed', severity: 'medium', size })))
    const segments = host.querySelectorAll('[aria-label="Received"], [aria-label="Classified"], [aria-label="Fixing"], [aria-label="Fixed"]')
    expect(segments).toHaveLength(4)
    for (const seg of segments) {
      expect(seg.className).toContain('w-full')
      expect(seg.parentElement?.className).toContain('flex-1')
    }
  })

  it('lets the table bar row grow next to its "4/4" label', () => {
    act(() => root.render(createElement(StatusStepper, { status: 'fixed', size: 'table' })))
    const group = host.querySelector('[role="group"]')!
    const barWrapper = group.firstElementChild as HTMLElement
    expect(barWrapper.className).toContain('flex-1')
    expect(group.textContent).toContain('4/4')
  })
})
