/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/repo/ProjectReposCard.test.tsx
 * PURPOSE: Console QA 20. A failed save replaced the whole card with
 *          "[object Object]" and threw the draft away. The reason now shows
 *          under the form, the draft stays, and Remove asks first.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P = '1000000f-0000-4000-8000-000000000000'
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))

import { ProjectReposCard } from './ProjectReposCard'

const REPOS = [
  { id: 'r1', repo_url: 'https://github.com/o/web', role: 'frontend', is_primary: true, default_branch: 'main', path_globs: [], github_app_installation_id: '1', indexing_enabled: true, last_indexed_at: null, created_at: '', updated_at: null },
  { id: 'r2', repo_url: 'https://github.com/o/api', role: 'backend', is_primary: false, default_branch: 'main', path_globs: [], github_app_installation_id: '1', indexing_enabled: true, last_indexed_at: null, created_at: '', updated_at: null },
]

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.apiFetch.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}
function click(el: Element | null | undefined) {
  if (!el) throw new Error('element not found')
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}
function button(label: string) {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
}

describe('ProjectReposCard', () => {
  it('shows a failed save as a sentence under the form and keeps the draft', async () => {
    mocks.apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return { ok: false, error: { code: 'BAD_REQUEST', message: '"x" is not a repo role.' } }
      }
      return { ok: true, data: REPOS }
    })
    act(() => root.render(createElement(MemoryRouter, null, createElement(ProjectReposCard, { projectId: P }))))
    await flush()

    click(document.querySelector('button[aria-label="Edit https://github.com/o/api"]'))
    const primary = [...document.querySelectorAll('input[type="checkbox"]')].at(-1) as HTMLInputElement
    click(primary)
    expect(document.body.textContent).toContain('Saving moves “primary” from https://github.com/o/web to this repo.')

    click(button('Save changes'))
    await flush()
    expect(document.body.textContent).toContain('"x" is not a repo role.')
    expect(document.body.textContent).not.toContain('[object Object]')
    // The form and the list are still there.
    expect(button('Save changes')).toBeTruthy()
    expect(document.body.textContent).toContain('Linked repos (2)')
  })

  it('labels each repo with its role so frontend and backend read apart', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: REPOS })
    act(() => root.render(createElement(MemoryRouter, null, createElement(ProjectReposCard, { projectId: P }))))
    await flush()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Frontend')
    expect(text).toContain('Backend')
    // Each role chip carries an icon next to its label.
    expect(document.querySelectorAll('span svg').length).toBeGreaterThanOrEqual(2)
  })

  it('asks before removing a repo', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: REPOS })
    act(() => root.render(createElement(MemoryRouter, null, createElement(ProjectReposCard, { projectId: P }))))
    await flush()
    click(document.querySelector('button[aria-label="Remove https://github.com/o/web"]'))
    expect(document.body.textContent).toContain('Remove this repo?')
    expect(document.body.textContent).toContain('It is the primary repo')
    expect(mocks.apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
  })
})
