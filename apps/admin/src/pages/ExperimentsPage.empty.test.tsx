/**
 * @vitest-environment jsdom
 */

/**
 * Console journeys 2026-10-27, P3: an empty Experiments page showed a
 * "No experiments yet" banner over six tiles of 0. It now opens on one
 * first-step card (one sentence, one button) and the banner steps aside, so
 * the page is never blank and never a wall of zeros. The page's help shows
 * expanded under it (RoutePageHelp reads the empty flag). The New form on
 * that empty page also names every variant name and weight input.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_EXPERIMENTS_STATS, type ExperimentsStats } from '../components/experiments/ExperimentsStatsTypes'

const mocks = vi.hoisted(() => ({ stats: null as ExperimentsStats | null }))

vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null }
    if (path === '/v1/admin/experiments/stats') return { ...base, data: mocks.stats }
    if (path?.startsWith('/v1/admin/experiments')) return { ...base, data: { data: [], total: 0 } }
    return { ...base, data: null }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => ({ activeProject: { project_name: 'App' } }) }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))

import { ExperimentsPage } from './ExperimentsPage'
import { ToastProvider } from '../lib/toast'
import { PageHelpProvider, usePageIsEmpty } from '../lib/pageHelpContext'

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

function EmptyProbe() {
  return createElement('output', { 'data-testid': 'empty-probe' }, usePageIsEmpty() ? 'empty' : 'full')
}

async function render(stats: ExperimentsStats) {
  mocks.stats = stats
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/experiments'] },
        createElement(ToastProvider, null, createElement(PageHelpProvider, null, createElement(ExperimentsPage), createElement(EmptyProbe))),
      ),
    )
  })
}

describe('ExperimentsPage empty state', () => {
  it('opens on one first-step card, not a banner over zero tiles', async () => {
    await render({ ...EMPTY_EXPERIMENTS_STATS, hasAnyProject: true, projectName: 'App', topPriority: 'no_experiments' })
    const card = host.querySelector('[data-testid="page-first-step"]')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('No experiments yet')
    expect(card?.textContent).toContain('Create experiment')
    // No status tiles and no second "No experiments" banner above it.
    expect(host.querySelector('[data-testid="page-status"]')).toBeNull()
    expect(host.textContent?.match(/No experiments/g)).toHaveLength(1)
    expect(host.querySelector('[data-testid="empty-probe"]')?.textContent).toBe('empty')
  })

  it('shows the status sentence once an experiment exists', async () => {
    await render({ ...EMPTY_EXPERIMENTS_STATS, hasAnyProject: true, projectName: 'App', topPriority: 'running', totalExperiments: 2, runningCount: 1 })
    expect(host.querySelector('[data-testid="page-first-step"]')).toBeNull()
    expect(host.querySelector('[data-testid="page-status"]')?.textContent).toContain('1 experiment running')
    expect(host.querySelector('[data-testid="empty-probe"]')?.textContent).toBe('full')
  })
})

/** Closest-label text, ignoring the control's own value (axe implicit-label). */
function implicitLabel(input: HTMLInputElement): string {
  const aria = input.getAttribute('aria-label')?.trim()
  if (aria) return aria
  const label = input.closest('label')
  if (!label) return ''
  const clone = label.cloneNode(true) as HTMLElement
  clone.querySelectorAll('input, textarea, select, button').forEach((el) => el.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('New experiment variant fields', () => {
  it('names the default Control and Treatment name and weight inputs', async () => {
    await render({ ...EMPTY_EXPERIMENTS_STATS, hasAnyProject: true, projectName: 'App', topPriority: 'no_experiments' })
    const heading = [...host.querySelectorAll('h2')].find((h) => h.textContent === 'New experiment')
    const card = heading?.parentElement
    expect(card).toBeTruthy()

    const control = card!.querySelector('input[value="Control"]') as HTMLInputElement
    const treatment = card!.querySelector('input[value="Treatment A"]') as HTMLInputElement
    expect(implicitLabel(control)).toBe('Name')
    expect(implicitLabel(treatment)).toBe('Variant 2 name')

    const weights = [...card!.querySelectorAll('input[type="number"]')] as HTMLInputElement[]
    expect(weights.map(implicitLabel)).toEqual(['Weight (0–1)', 'Variant 2 weight (0–1)'])

    const add = [...card!.querySelectorAll('button')].find((b) => b.textContent?.includes('Add variant'))
    expect(add).toBeTruthy()
    await act(async () => { add!.click() })

    const added = card!.querySelector('input[value="Treatment B"]') as HTMLInputElement
    expect(implicitLabel(added)).toBe('Variant 3 name')
    const weightsAfter = [...card!.querySelectorAll('input[type="number"]')] as HTMLInputElement[]
    expect(weightsAfter.map(implicitLabel)).toEqual([
      'Weight (0–1)',
      'Variant 2 weight (0–1)',
      'Variant 3 weight (0–1)',
    ])
  })
})
