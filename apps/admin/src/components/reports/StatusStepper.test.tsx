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
 *
 * The bar row is one image. Its accessible name is the current step and
 * "n of 4", and that list is the only name exposed. Sighted captions are
 * aria-hidden so they are not announced again. Segments are aria-hidden.
 * Full-size dismissed uses the visible "Dismissed" caption and hides the bar.
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

/** Names exposed to assistive tech. Children of an image are presentational.
 *  `title` is a description when the element already has text. */
function accessibleNames(root: HTMLElement): string[] {
  const names: string[] = []
  const walk = (el: Element, insideImg: boolean) => {
    if (el.getAttribute('aria-hidden') === 'true') return
    const role = el.getAttribute('role')
    const aria = el.getAttribute('aria-label')
    if (!insideImg && aria) names.push(aria)
    if (insideImg || role === 'img') {
      for (const child of el.children) walk(child, true)
      return
    }
    const elementChildren = [...el.children]
    const hasDirectText = [...el.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    )
    if (elementChildren.length === 0 || hasDirectText) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text) names.push(text)
      return
    }
    for (const child of elementChildren) walk(child, false)
  }
  for (const child of root.children) walk(child, false)
  return names
}

describe('StatusStepper', () => {
  it.each(['table', 'compact', 'full'] as const)('gives every segment wrapper flex-1 (%s)', (size) => {
    act(() => root.render(createElement(StatusStepper, { status: 'fixed', severity: 'medium', size })))
    const segments = host.querySelectorAll('[role="img"] > span > [aria-hidden="true"]')
    expect(segments).toHaveLength(4)
    for (const seg of segments) {
      expect(seg.className).toContain('w-full')
      expect(seg.parentElement?.className).toContain('flex-1')
    }
  })

  it.each([
    ['table', 'new', 'Received', 1],
    ['compact', 'fixing', 'Fixing', 3],
    ['full', 'fixed', 'Fixed', 4],
  ] as const)('names %s progress once (%s)', (size, status, label, step) => {
    act(() => root.render(createElement(StatusStepper, { status, severity: 'medium', size })))
    // The whole list. A filter for "label" plus "n of 4" would miss a
    // caption such as "Fixing" or "3/4" announced beside the image.
    expect(accessibleNames(host)).toEqual([`Status: ${label}, step ${step} of 4`])
    expect(host.querySelectorAll('[role="img"]')).toHaveLength(1)
    const segments = host.querySelectorAll('[role="img"] [aria-hidden="true"]')
    expect(segments).toHaveLength(4)
    for (const seg of segments) {
      expect(seg.getAttribute('role')).toBeNull()
      expect(seg.hasAttribute('aria-label')).toBe(false)
    }
    if (size === 'compact' || size === 'table') {
      // The caption is the step's word, never a bare "n/4" that needs a legend.
      const caption = [...host.querySelectorAll('span')].find((el) => el.textContent === label)
      expect(caption?.getAttribute('aria-hidden')).toBe('true')
      expect(caption?.closest('[role="img"]')).toBeNull()
      expect(host.textContent).not.toContain(`${step}/4`)
    }
    if (size === 'full') {
      for (const stepLabel of ['Received', 'Classified', 'Fixing', 'Fixed']) {
        const node = [...host.querySelectorAll('span')].find((el) => el.textContent === stepLabel)
        expect(node?.closest('[aria-hidden="true"]')).not.toBeNull()
        expect(node?.closest('[role="img"]')).toBeNull()
      }
    }
  })

  it('names the dismissed bar as an image', () => {
    act(() => root.render(createElement(StatusStepper, { status: 'dismissed' })))
    const bar = host.querySelector('[aria-label="Dismissed"]')
    expect(bar?.getAttribute('role')).toBe('img')
    expect(accessibleNames(host).filter((name) => name.includes('Dismissed'))).toEqual(['Dismissed'])
  })

  it('announces full-size dismissed from the visible caption once', () => {
    act(() => root.render(createElement(StatusStepper, { status: 'dismissed', size: 'full' })))
    expect(host.querySelector('[role="img"]')).toBeNull()
    expect(host.querySelector('[aria-label]')).toBeNull()
    const bar = host.querySelector('span.bg-surface-overlay')
    expect(bar?.getAttribute('aria-hidden')).toBe('true')
    expect(accessibleNames(host).filter((name) => name.includes('Dismissed'))).toEqual(['Dismissed'])
  })

  // Fresh-eyes sweep 2026-11-18: the table showed a bare ⊘ with no word for a dismissed report.
  it('prints the word for a dismissed report in the table row', () => {
    act(() => root.render(createElement(StatusStepper, { status: 'dismissed', size: 'table' })))
    expect(host.querySelector('[data-testid="status-stepper-word"]')?.textContent).toBe('Dismissed')
    expect(accessibleNames(host).filter((name) => name.includes('Dismissed'))).toEqual(['Dismissed'])
  })

  it('lets the table bar row grow next to its "Fixed" label', () => {
    act(() => root.render(createElement(StatusStepper, { status: 'fixed', size: 'table' })))
    const img = host.querySelector('[role="img"]')!
    const barWrapper = img.parentElement as HTMLElement
    expect(barWrapper.className).toContain('flex-1')
    expect(host.textContent).toContain('Fixed')
  })

  // Console UX pass 2026-11-22: the table's bar alone was an unlabeled meter.
  // Every step now prints its word and "n of 4" as text (keyboard and touch
  // users see it without a tooltip); the resting Classified step stays muted
  // (round-3 sweep 2026-11-19: "○ Classified" shouted on almost every row).
  it('labels every table step with its word and "n of 4", Classified muted', () => {
    act(() => root.render(createElement(StatusStepper, { status: 'classified', size: 'table' })))
    const word = host.querySelector('[data-testid="status-stepper-word"]')
    expect(word?.textContent).toBe('Classified')
    expect(word?.className).toContain('text-fg-muted')
    expect(host.querySelector('[data-testid="status-stepper-step"]')?.textContent).toBe('2 of 4')
    expect(accessibleNames(host)).toEqual(['Status: Classified, step 2 of 4'])
    act(() => root.render(createElement(StatusStepper, { status: 'fixing', size: 'table' })))
    expect(host.querySelector('[data-testid="status-stepper-word"]')?.className).not.toContain('text-fg-muted')
    expect(host.querySelector('[data-testid="status-stepper-step"]')?.textContent).toBe('3 of 4')
    expect(host.querySelector('[data-testid="status-stepper-word"]')?.textContent).toBe('Fixing')
  })

  // 2026-11-18: the step's word carries the status mark (colour plus glyph).
  it('marks the step word with the report status', () => {
    const cases: Array<[string, string]> = [['new', 'waiting'], ['fixing', 'running'], ['fixed', 'passed'], ['reopened', 'failed']]
    for (const [status, mark] of cases) {
      act(() => root.render(createElement(StatusStepper, { status, size: 'table' })))
      expect(host.querySelector('[data-testid="status-stepper-word"] [data-testid="status-mark"]')?.getAttribute('data-status')).toBe(mark)
    }
    act(() => root.render(createElement(StatusStepper, { status: 'dismissed' })))
    expect(host.querySelector('[data-testid="status-mark"]')?.getAttribute('data-status')).toBe('cancelled')
  })
})
