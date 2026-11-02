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
    (b) => b.getAttribute('aria-label') === `${label} in the sidebar`,
  )
  if (!el) throw new Error(`no switch for "${label}"`)
  return el
}

describe('LabsPanel', () => {
  it('renders the intro, every group heading and every Lab with its own switch', () => {
    render()
    const text = container.textContent ?? ''
    expect(text).toContain('Pages to keep in your sidebar under Labs')
    expect(text).toContain('under More pages')
    for (const heading of Object.values(LAB_GROUP_LABEL)) expect(text).toContain(heading)
    for (const f of LAB_FEATURES) {
      expect(text).toContain(f.label)
      expect(text).toContain(f.description)
      expect(switchFor(f.label).getAttribute('aria-checked')).toBe('false')
    }
    expect(container.querySelectorAll('button[role="switch"]')).toHaveLength(LAB_FEATURES.length)
  })

  // Console journeys 2026-10-27: To-do, Bug clusters, Pull requests, CI
  // runners and Code map read "Off" while they still worked. The switch
  // only decides the sidebar, so that is what it says.
  it('says where the page is listed, never that the page is off', () => {
    render()
    const row = container.querySelector('#lab-to-do') ?? switchFor('To-do list').closest('[id]')
    expect(row?.textContent).toContain('Not in sidebar')
    expect(row?.textContent).not.toMatch(/Off/)
    act(() => switchFor('To-do list').click())
    expect((container.querySelector('#lab-to-do') ?? switchFor('To-do list').closest('[id]'))?.textContent).toContain('In sidebar')
    // labs.ts caches the set in memory: switch it back so the next test starts clean.
    act(() => switchFor('To-do list').click())
  })

  it('links Open to the page whether or not the Lab is on (the switch only pins it to the sidebar)', () => {
    render()
    const open = () => container.querySelector<HTMLElement>('[data-testid="lab-open-bug-clusters"]')!
    expect(open().tagName).toBe('A')
    expect(open().getAttribute('href')).toBe('/graph')

    act(() => switchFor('Bug clusters').click())

    expect(storedLabs()).toContain('bug-clusters')
    expect(switchFor('Bug clusters').getAttribute('aria-checked')).toBe('true')
    expect(open().tagName).toBe('A')
    expect(open().getAttribute('href')).toBe('/graph')
    expect(JSON.parse(window.localStorage.getItem('mushi:labs') ?? '[]')).toEqual(['bug-clusters'])

    act(() => switchFor('Bug clusters').click())
    expect(storedLabs()).not.toContain('bug-clusters')
    expect(open().getAttribute('href')).toBe('/graph')
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
