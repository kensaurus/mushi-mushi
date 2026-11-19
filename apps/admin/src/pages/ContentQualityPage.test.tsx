/**
 * @vitest-environment jsdom
 */

/**
 * Console journeys 2026-10-27, Content checks: an empty page still showed a
 * row of filter chips with bare words (statuses / reasons / types). With
 * nothing open and nothing narrowed, the page is its empty state and one way
 * to see past issues; the filters come back once there is something to filter.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ paths: [] as string[], total: 0, past: 3 }))

vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    if (path) mocks.paths.push(path)
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null }
    if (path?.startsWith('/v1/admin/content-quality?')) {
      const status = new URLSearchParams(path.split('?')[1]).get('status')
      if (status === 'all' && path.includes('limit=1&')) {
        return { ...base, data: { items: mocks.past ? [{ id: 'x', created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }] : [], total: mocks.past } }
      }
      return { ...base, data: status === 'all' ? { items: [], total: 0 } : { items: [], total: mocks.total } }
    }
    return { ...base, data: null }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ canEditProject: true }) }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: { guide: 1 } }))

import { ContentQualityPage } from './ContentQualityPage'
import { ToastProvider } from '../lib/toast'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.paths = []
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(url = '/content') {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(ToastProvider, null, createElement(ContentQualityPage))))
  })
}

describe('ContentQualityPage empty state', () => {
  it('hides the filters when nothing is open and offers past issues instead', async () => {
    mocks.total = 0
    await render()
    expect(host.querySelector('[role="toolbar"]')).toBeNull()
    expect(host.textContent).toContain('No open content issues')
    // All clear carries a mark, not a bare sentence; its scope is what was reported, never the page's load time.
    expect(host.querySelector('[data-testid="content-quality-all-clear"] svg')).not.toBeNull()
    expect(host.querySelector('[data-testid="content-quality-scope"]')!.textContent).toMatch(/3 reported so far, the last/)
    expect(host.textContent).not.toContain('checked')
    const past = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Show past issues')!
    await act(async () => past.click())
    // Looking at every status is a narrowed view: the filters come back.
    expect(mocks.paths.some((p) => p.includes('status=all') && p.includes('limit=50'))).toBe(true)
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull()
  })

  it('says none reported yet, in grey and without "Show past issues", when nothing ever came in', async () => {
    mocks.total = 0
    mocks.past = 0
    await render()
    expect(host.querySelector('[data-testid="content-quality-scope"]')!.textContent).toContain('none reported yet')
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Show past issues')).toBe(false)
    mocks.past = 3
  })

  it('keeps the filters when a link already narrowed the list', async () => {
    mocks.total = 0
    await render('/content?reason=user_flag')
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull()
  })

  it('gives the key search a field wide enough for the whole placeholder', async () => {
    mocks.total = 0
    await render('/content?reason=user_flag')
    const input = host.querySelector('input[type="search"]') as HTMLInputElement
    // w-64 shows about 21 characters of this Input; the phrase is longer, so
    // the width lives on the label the toolbar flex row actually sizes.
    expect(input.placeholder).toBe('Search keys on this page')
    expect(input.placeholder.length).toBeGreaterThan(21)
    expect(input.className).not.toMatch(/(?:^|\s)(?:sm:)?w-64(?:\s|$)/)
    const label = input.closest('label')!
    expect(label.className).toContain('sm:w-80')
    expect(label.className).toContain('shrink-0')
  })
})
