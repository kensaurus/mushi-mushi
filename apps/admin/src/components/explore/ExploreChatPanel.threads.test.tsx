/**
 * @vitest-environment jsdom
 *
 * Code map → Ask: with no past chats the thread list is one line, not a tall
 * empty box beside the chat; with threads it is the full list.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ threads: [] as Array<Record<string, unknown>> }))

vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => children }))
vi.mock('../../lib/supabase', () => ({
  apiFetch: async () => ({ ok: true, data: { threads: state.threads } }),
}))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { reports: [] }, loading: false, error: null, reload: () => {} }),
}))
vi.mock('../../lib/useTheme', () => ({ useTheme: () => ({ theme: 'light', resolved: 'light' }) }))
vi.mock('../../lib/toast', () => ({ useToast: () => ({ error: () => {}, success: () => {} }) }))

import { ExploreChatPanel } from './ExploreChatPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(ExploreChatPanel, { projectId: 'p1' })))
  })
}

describe('ExploreChatPanel threads', () => {
  it('shows one line when there are no past chats', async () => {
    state.threads = []
    await render()
    expect(host.querySelector('[data-testid="explore-threads-empty"]')!.textContent).toContain('No past chats yet.')
  })

  it('shows the list when there are threads', async () => {
    state.threads = [{ id: 't1', title: 'Auth flow', preview: null, updated_at: '2026-11-17T00:00:00Z' }]
    await render()
    expect(host.querySelector('[data-testid="explore-threads-empty"]')).toBeNull()
    expect(host.textContent).toContain('Auth flow')
  })
})
