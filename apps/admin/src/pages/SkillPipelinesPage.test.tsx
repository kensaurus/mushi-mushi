/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/SkillPipelinesPage.test.tsx
 * PURPOSE: /skills console QA QA 22 — the catalog search box lost focus on
 *          every keystroke because a skeleton (loading) or an empty state
 *          (no match) replaced the whole tab, input included. The same input
 *          element must stay mounted and focused through both, and stay
 *          editable after a no-match query. Also QA 245: `?tab=foo` renders
 *          the catalog instead of crashing.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PageDataState = { data: unknown; loading: boolean; error: string | null; isValidating: boolean }

const SKILLS = [
  { id: '1', slug: 'audit-ux', category: 'audit', title: 'Audit UX', description: 'd', chain_slugs: [], updated_at: '' },
]

const state = vi.hoisted(() => ({
  catalog: (_path: string): PageDataState => ({ data: null, loading: true, error: null, isValidating: true }),
}))

vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { reload: vi.fn(), lastFetchedAt: null }
    if (path && path.startsWith('/v1/admin/skills?')) return { ...base, ...state.catalog(path) }
    return { ...base, data: null, loading: false, error: null, isValidating: false }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/skillsModeUx', () => ({
  useSkillsUx: () => ({
    isQuickstart: false,
    isBeginner: false,
    isAdvanced: true,
    hideTabs: false,
    plainBanner: false,
    hideSkillsSnapshot: true,
    hideEndpointReadout: true,
  }),
  resolveQuickSkillsTab: () => 'catalog',
}))
vi.mock('../lib/realtime', () => ({ useRealtime: () => undefined }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../lib/heroSnapshots', () => ({ usePublishPageHeroStats: () => undefined }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: {} }))

import { SkillPipelinesPage } from './SkillPipelinesPage'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

function render(url = '/skills?tab=catalog') {
  act(() => {
    root.render(
      createElement(MemoryRouter, { initialEntries: [url] }, createElement(SkillPipelinesPage)),
    )
  })
}

function searchBox(): HTMLInputElement | null {
  return host.querySelector('input[aria-label="Search skills"]')
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SkillPipelinesPage catalog search (QA 22)', () => {
  it('keeps the same focused input while a search loads and when nothing matches', () => {
    state.catalog = (path) =>
      path.includes('q=')
        ? { data: null, loading: true, error: null, isValidating: true }
        : { data: { data: SKILLS, grouped: { audit: SKILLS }, total: 1 }, loading: false, error: null, isValidating: false }
    render()
    const input = searchBox()
    expect(input).not.toBeNull()
    input!.focus()

    type(input!, 'a')
    expect(searchBox()).toBe(input)
    type(input!, 'au')
    act(() => vi.advanceTimersByTime(400))
    // The debounced query is now loading: the skeleton sits under the box.
    expect(searchBox()).toBe(input)
    expect(document.activeElement).toBe(input)

    // The query matched nothing: the box is still there and editable.
    state.catalog = () => ({ data: { data: [], grouped: {}, total: 0 }, loading: false, error: null, isValidating: false })
    type(input!, 'zzz')
    act(() => vi.advanceTimersByTime(400))
    expect(host.textContent).toContain('No skills match')
    expect(searchBox()).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input!.value).toBe('zzz')
  })
})

describe('SkillPipelinesPage catalog layout', () => {
  const workflows = Array.from({ length: 8 }, (_, i) => ({
    id: `w${i}`,
    slug: `workflow-${i}`,
    category: 'workflow',
    title: i === 0 ? 'workflow-0' : `Workflow ${i}`,
    description: 'd',
    chain_slugs: [],
    updated_at: '',
  }))
  const audits = [{ id: 'a1', slug: 'audit-ux', category: 'audit', title: 'Audit UX', description: 'd', chain_slugs: [], updated_at: '' }]
  const all = [...workflows, ...audits]

  function buttonByText(text: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))
  }

  beforeEach(() => {
    state.catalog = () => ({
      data: { data: all, grouped: { workflow: workflows, audit: audits }, total: all.length },
      loading: false,
      error: null,
      isValidating: false,
    })
  })

  it('opens Workflows with 6 cards, keeps other categories closed, and expands on Show all', () => {
    render()
    expect(host.textContent).toContain('Workflow 5')
    expect(host.textContent).not.toContain('Workflow 6')
    expect(host.textContent).not.toContain('Audit UX')
    act(() => buttonByText('Show all 8')!.click())
    expect(host.textContent).toContain('Workflow 7')
  })

  it('filters to one category from its chip', () => {
    render()
    act(() => buttonByText('Audit')!.click())
    expect(host.textContent).toContain('Audit UX')
    expect(host.textContent).not.toContain('Workflow 1')
  })

  it('shows the slug only when it differs from the title', () => {
    render()
    const monoTexts = [...host.querySelectorAll('p.font-mono')].map((p) => p.textContent)
    expect(monoTexts).toContain('workflow-1')
    expect(monoTexts).not.toContain('workflow-0')
  })
})

describe('SkillPipelinesPage tab guard (QA 245)', () => {
  it('renders the catalog for an unknown ?tab instead of crashing', () => {
    state.catalog = () => ({ data: { data: SKILLS, grouped: { audit: SKILLS }, total: 1 }, loading: false, error: null, isValidating: false })
    render('/skills?tab=foo')
    expect(searchBox()).not.toBeNull()
    expect(host.textContent).toContain('Audit UX')
  })
})
