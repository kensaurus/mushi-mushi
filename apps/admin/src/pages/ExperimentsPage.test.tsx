/**
 * FILE: apps/admin/src/pages/ExperimentsPage.test.tsx
 * PURPOSE: Class-contract for the experiment list row (jsdom has no layout).
 *          Below sm the row stacks and Launch does not shrink. From sm to md
 *          the variant count and mode stay on the meta line (report fbea6eb6).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type * as ExperimentsModeUx from '../lib/experimentsModeUx'
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
  const actual = await importOriginal<typeof ExperimentsModeUx>()
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

function classTokens(className: string | undefined): string[] {
  return (className ?? '').split(/\s+/).filter(Boolean)
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
    // The actions wrapper is a block td's child, so shrink-0 on it does nothing.
    // Launch and the icon buttons still refuse to shrink.
    const actionsWrap = actions?.firstElementChild
    expect(actionsWrap?.tagName).toBe('DIV')
    expect(classTokens(actionsWrap?.className)).not.toContain('shrink-0')
    expect(classTokens(actionsWrap?.className)).toContain('w-full')
    const actionButtons = Array.from(actionsWrap?.querySelectorAll('button') ?? [])
    expect(actionButtons.length).toBeGreaterThan(0)
    for (const button of actionButtons) {
      expect(classTokens(button.className)).toContain('shrink-0')
    }

    const row = launch?.closest('tr')
    expect(row?.className).toContain('block')
    expect(row?.className).toContain('sm:table-row')
    const name = row?.querySelector('.wrap-break-word')
    expect(name?.textContent).toContain('Button colour CTA test')
    expect(classTokens(name?.className)).not.toContain('truncate')

    const cells = Array.from(row?.querySelectorAll(':scope > td') ?? [])
    // Variants and Mode only. A bare `td.hidden` also matches Status and Created.
    const hiddenUntilMd = cells.filter((td) => {
      const tokens = classTokens(td.className)
      return tokens.includes('hidden') && tokens.includes('md:table-cell') && !tokens.includes('sm:table-cell')
    })
    expect(hiddenUntilMd.map((td) => td.textContent?.trim())).toEqual(['2', 'Static'])
    const anyHidden = cells.filter((td) => classTokens(td.className).includes('hidden'))
    expect(anyHidden.length).toBeGreaterThan(hiddenUntilMd.length)

    const meta = row?.querySelector(':scope > td div.md\\:hidden')
    expect(meta).toBeTruthy()
    expect(classTokens(meta?.className)).not.toContain('sm:hidden')
    const variant = Array.from(meta?.querySelectorAll('span') ?? []).find((el) => el.textContent === '2 variants')
    const mode = Array.from(meta?.querySelectorAll('span') ?? []).find((el) => el.textContent === 'Static')
    expect(variant).toBeTruthy()
    expect(mode).toBeTruthy()
    expect(variant?.closest('.sm\\:hidden')).toBeNull()
    expect(mode?.closest('.sm\\:hidden')).toBeNull()
    const hiddenFromSm = Array.from(meta?.querySelectorAll(':scope > .sm\\:hidden') ?? [])
    expect(hiddenFromSm).toHaveLength(2)
    expect(hiddenFromSm[0]?.textContent).toContain('Draft')
    expect(hiddenFromSm[1]?.textContent).not.toContain('variants')
    expect(hiddenFromSm[1]?.textContent?.trim().length).toBeGreaterThan(0)
  })

  it('says the experiment name wraps', () => {
    const source = readFileSync(join(__dirname, 'ExperimentsPage.tsx'), 'utf8')
    expect(source).toContain('the name wraps')
    expect(source).not.toContain('the name truncates')
  })
})
