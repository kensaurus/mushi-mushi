/**
 * FILE: apps/admin/src/pages/ExperimentsPage.test.tsx
 * PURPOSE: The experiment list keeps Launch and the trailing icon on screen
 *          at phone width. Below sm the row stacks; the action label does
 *          not shrink (report fbea6eb6).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_EXPERIMENTS_STATS } from '../components/experiments/ExperimentsStatsTypes'

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const idle = {
      loading: false,
      error: null,
      errorCode: null,
      errorMessage: null,
      requestId: null,
      errorEndpoint: null,
      isValidating: false,
      lastFetchedAt: null,
      reload: () => {},
    }
    if (path?.includes('/stats')) {
      return {
        ...idle,
        data: {
          ...EMPTY_EXPERIMENTS_STATS,
          hasAnyProject: true,
          projectId: 'p1',
          projectName: 'App',
          totalExperiments: 1,
          draftCount: 1,
          draftsReadyToLaunch: 1,
          topPriority: 'draft_ready',
        },
      }
    }
    if (path?.includes('/experiments')) {
      return {
        ...idle,
        data: {
          total: 1,
          data: [{
            id: 'exp-1',
            project_id: 'p1',
            name: 'Button colour CTA test with a very long experiment name',
            description: null,
            hypothesis: 'Orange CTA lifts clicks',
            status: 'draft',
            bandit_enabled: false,
            start_at: null,
            end_at: null,
            winner_variant_id: null,
            created_at: '2026-10-20T00:00:00Z',
            experiment_variants: [
              { id: 'v1', experiment_id: 'exp-1', name: 'Control', description: null, config: {}, traffic_weight: 0.5, bandit_alpha: 1, bandit_beta: 1 },
              { id: 'v2', experiment_id: 'exp-1', name: 'Treatment', description: null, config: {}, traffic_weight: 0.5, bandit_alpha: 1, bandit_beta: 1 },
            ],
          }],
        },
      }
    }
    return { ...idle, data: null }
  },
}))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => ({ activeProject: { project_name: 'App' } }) }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/copy', () => ({ usePageCopy: () => null }))
vi.mock('../lib/experimentsModeUx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/experimentsModeUx')>()
  return {
    ...actual,
    useExperimentsUx: () => ({
      isQuickstart: false,
      isBeginner: false,
      isAdvanced: true,
      hideTabs: false,
      plainBanner: false,
      hideOverviewChrome: false,
      hideExperimentsSnapshot: true,
    }),
  }
})
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: { status: 0, heroOrSnapshot: 1 } }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ children }: { children?: unknown }) => createElement('div', null, children as never),
}))

import { ExperimentsPage } from './ExperimentsPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function render() {
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/experiments'] }, createElement(ExperimentsPage)))
  })
}

describe('Experiments list at phone width', () => {
  it('stacks the row below sm and keeps Launch plus the view icon from shrinking', () => {
    render()
    const table = host.querySelector('table')
    expect(table?.className).toContain('block')
    expect(table?.className).toContain('sm:table')

    const launch = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Launch')
    expect(launch).toBeTruthy()
    expect(launch?.className).toContain('shrink-0')
    expect(launch?.className).toContain('whitespace-nowrap')

    const view = host.querySelector('button[aria-label="View experiment Button colour CTA test with a very long experiment name"]')
    expect(view).toBeTruthy()
    expect(view?.className).toContain('shrink-0')

    const actions = launch?.closest('td')
    expect(actions?.className).toContain('block')
    expect(actions?.className).toContain('sm:table-cell')
    expect(actions?.querySelector('.shrink-0')).toBeTruthy()

    const row = launch?.closest('tr')
    expect(row?.className).toContain('block')
    expect(row?.className).toContain('sm:table-row')
    // Status stays on the narrow row; the extra columns stay off until there is room.
    expect(row?.textContent).toContain('Draft')
    expect(row?.querySelector('td.hidden.md\\:table-cell, td.hidden')).toBeTruthy()
  })
})
