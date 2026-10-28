/**
 * @vitest-environment jsdom
 *
 * Research "Attach to bug": the bug is picked by its title, never pasted as
 * an id. The picker opens on demand, Attach stays disabled until a bug is
 * picked, and the card closes the picker once the finding is saved.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ paths: [] as Array<string | null> }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return {
      data: { reports: [{ id: 'rep-1111', title: 'Login loops after password reset', severity: 'high' }] },
      loading: false,
      error: null,
      isValidating: false,
      reload: vi.fn(),
      lastFetchedAt: null,
    }
  },
}))

import { ResearchSnippetCard } from './ResearchSnippetCard'
import type { Snippet } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const snippet = { id: 's1', url: 'https://example.com/a', title: 'Supabase auth loop', snippet: 'Clear the session…', attached_to_report_id: null } as unknown as Snippet

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  state.paths = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const button = (text: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)

describe('ResearchSnippetCard', () => {
  it('opens the picker on demand and attaches the picked bug', async () => {
    const onAttach = vi.fn(async () => true)
    act(() => root.render(createElement(MemoryRouter, null, createElement(ResearchSnippetCard, { snippet, onAttach }))))
    // No bug list read until the user asks to attach.
    expect(state.paths).toEqual([])
    expect(host.textContent).not.toMatch(/paste|uuid/i)

    act(() => button('Attach to bug')!.click())
    expect(button('Attach to this bug')!.disabled).toBe(true)

    const bug = Array.from(host.querySelectorAll('ul button')).find((b) => b.textContent?.includes('Login loops'))!
    act(() => (bug as HTMLButtonElement).click())
    expect(host.textContent).toContain('Login loops after password reset')
    expect(button('Attach to this bug')!.disabled).toBe(false)

    await act(async () => {
      button('Attach to this bug')!.click()
    })
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ id: 'rep-1111' }))
    expect(host.querySelector('[data-testid="research-attach"]')).toBeNull()
  })

  it('links an attached finding to its bug', () => {
    act(() =>
      root.render(
        createElement(MemoryRouter, null, createElement(ResearchSnippetCard, { snippet: { ...snippet, attached_to_report_id: 'rep-2222-xyz' } as Snippet, onAttach: vi.fn() })),
      ),
    )
    expect(host.textContent).toContain('Saved on bug')
    expect(host.querySelector('a[href="/reports/rep-2222-xyz"]')).not.toBeNull()
  })
})
