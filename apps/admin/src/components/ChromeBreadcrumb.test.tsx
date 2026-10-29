/**
 * @vitest-environment jsdom
 */

/**
 * The top-bar breadcrumb named a cycle section the flat sidebar no longer
 * shows: Home read "Bugs › Home", Bugs "Bugs › Bugs", Content checks
 * "Verify › Content checks" (console sweep, 2026-10-28). It now follows the
 * sidebar.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChromeBreadcrumb } from './ChromeBreadcrumb'

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

async function trailAt(path: string): Promise<string> {
  await act(async () => {
    root.render(createElement(MemoryRouter, { key: path, initialEntries: [path] }, createElement(ChromeBreadcrumb)))
  })
  return (container.querySelector('nav')?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('ChromeBreadcrumb', () => {
  it('shows a core page on its own', async () => {
    expect(await trailAt('/dashboard')).toBe('Home')
    expect(await trailAt('/reports')).toBe('Bugs')
    expect(await trailAt('/settings')).toBe('Settings')
  })

  it('puts a sub-page under the page the sidebar lists it under', async () => {
    expect(await trailAt('/dashboard?view=apps')).toBe('Home›Overview')
    expect(await trailAt('/content')).toBe('Checks›Content checks')
    expect(await trailAt('/team?view=billing')).toBe('Team›Billing')
  })

  it('keeps the More pages group for pages outside the core list', async () => {
    expect(await trailAt('/graph')).toBe('Bugs›Bug clusters')
  })

  it('says Console once on a page it does not know', async () => {
    expect(await trailAt('/does-not-exist')).toBe('Console')
  })
})
