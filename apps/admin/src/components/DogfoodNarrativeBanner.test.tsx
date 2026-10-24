/**
 * FILE: apps/admin/src/components/DogfoodNarrativeBanner.test.tsx
 * PURPOSE: The narrative banner keeps its box while its data loads, so the
 *          Bugs page does not jump when it arrives (layout shift, 2026-10-24).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  advanced: false,
  loading: true,
  data: null as unknown,
}))

vi.mock('../lib/mode', () => ({ useAdminMode: () => ({ isAdvanced: state.advanced }) }))
vi.mock('./ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({
    loading: state.loading,
    activeProject: state.loading ? null : { project_id: 'p1', project_name: 'glot.it', report_count: 12 },
  }),
}))
vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({ loading: state.loading, data: state.data }),
}))

import { DogfoodNarrativeBanner } from './DogfoodNarrativeBanner'

const html = () => renderToStaticMarkup(<MemoryRouter><DogfoodNarrativeBanner /></MemoryRouter>)

beforeEach(() => {
  state.advanced = false
  state.loading = true
  state.data = null
})

describe('DogfoodNarrativeBanner', () => {
  it('renders a placeholder of the banner height while its data loads', () => {
    expect(html()).toContain('data-testid="narrative-placeholder"')
    expect(html()).toContain('h-12.5')
  })

  it('renders the sentence once loaded', () => {
    state.loading = false
    state.data = { topComponents: [{ component: 'Checkout', count: 6, draftedFixes: 2, mergedFixes: 1 }] }
    const out = html()
    expect(out).not.toContain('narrative-placeholder')
    expect(out).toContain('Checkout')
  })

  it('renders nothing in advanced mode, loading or not', () => {
    state.advanced = true
    expect(html()).toBe('')
  })
})
