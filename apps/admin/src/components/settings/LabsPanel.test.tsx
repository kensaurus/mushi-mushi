/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/settings/LabsPanel.test.tsx
 * PURPOSE: Settings › Labs lists every Lab from the registry with a named
 *          switch, and switching one on persists it and makes its "Open"
 *          link a real link to the Lab's page.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LabsPanel } from './LabsPanel'
import { LAB_FEATURES, LAB_GROUP_LABEL } from '../../lib/labs'

const storedLabs = (): string[] => JSON.parse(window.localStorage.getItem('mushi:labs') ?? '[]') as string[]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.removeItem('mushi:labs')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.localStorage.removeItem('mushi:labs')
})

function render(Panel: typeof LabsPanel = LabsPanel): void {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(Panel)))
  })
}

function switchFor(label: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="switch"]')).find(
    (b) => b.getAttribute('aria-label') === label,
  )
  if (!el) throw new Error(`no switch for "${label}"`)
  return el
}

describe('LabsPanel', () => {
  it('renders the intro, every group heading and every Lab with its own switch', () => {
    render()
    const text = container.textContent ?? ''
    expect(text).toContain('Labs are pages outside the core bug → diagnosis → fix loop')
    expect(text).toContain('reachable from ⌘K and by link')
    for (const heading of Object.values(LAB_GROUP_LABEL)) expect(text).toContain(heading)
    for (const f of LAB_FEATURES) {
      expect(text).toContain(f.label)
      expect(text).toContain(f.description)
      expect(switchFor(f.label).getAttribute('aria-checked')).toBe('false')
    }
    expect(container.querySelectorAll('button[role="switch"]')).toHaveLength(LAB_FEATURES.length)
  })

  it('keeps the Open link disabled until the Lab is on, then links to its page', () => {
    render()
    const open = () => container.querySelector<HTMLElement>('[data-testid="lab-open-bug-clusters"]')!
    expect(open().tagName).toBe('BUTTON')
    expect((open() as HTMLButtonElement).disabled).toBe(true)
    expect(container.querySelector('a[href="/graph"]')).toBeNull()

    act(() => switchFor('Bug clusters').click())

    expect(storedLabs()).toContain('bug-clusters')
    expect(switchFor('Bug clusters').getAttribute('aria-checked')).toBe('true')
    expect(open().tagName).toBe('A')
    expect(open().getAttribute('href')).toBe('/graph')
    expect(JSON.parse(window.localStorage.getItem('mushi:labs') ?? '[]')).toEqual(['bug-clusters'])

    act(() => switchFor('Bug clusters').click())
    expect(storedLabs()).not.toContain('bug-clusters')
    expect(open().tagName).toBe('BUTTON')
  })

  it('shows a Lab already on from a previous visit as on', async () => {
    window.localStorage.setItem('mushi:labs', JSON.stringify(['releases']))
    // A previous visit means a fresh page load: the Labs module reads storage
    // on its first use, so load it fresh instead of reusing this file's cache.
    vi.resetModules()
    const fresh = await import('./LabsPanel')
    render(fresh.LabsPanel)
    expect(switchFor('Releases').getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('a[href="/releases"]')).not.toBeNull()
  })
})
