/**
 * FILE: apps/admin/src/pages/ExperimentsPage.test.tsx
 * PURPOSE: Contract for the experiment list row (report fbea6eb6).
 *          Below sm the row stacks, Launch does not shrink, and the name wraps.
 *          From sm to md the variant count and split stay on the meta line.
 *          Explicit table roles stay on the stacked markup. A Chromium check,
 *          when the browser is installed, measures Launch inside the card at 390px.
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
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
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
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
    // Variants and Split only. A bare `td.hidden` also matches Status and Created.
    const hiddenUntilMd = cells.filter((td) => {
      const tokens = classTokens(td.className)
      return tokens.includes('hidden') && tokens.includes('md:table-cell') && !tokens.includes('sm:table-cell')
    })
    expect(hiddenUntilMd.map((td) => td.textContent?.trim())).toEqual(['2', 'Even split'])
    const anyHidden = cells.filter((td) => classTokens(td.className).includes('hidden'))
    expect(anyHidden.length).toBeGreaterThan(hiddenUntilMd.length)

    const meta = row?.querySelector(':scope > td div.md\\:hidden')
    expect(meta).toBeTruthy()
    expect(classTokens(meta?.className)).not.toContain('sm:hidden')
    const variant = Array.from(meta?.querySelectorAll('span') ?? []).find((el) => el.textContent === '2 variants')
    const split = Array.from(meta?.querySelectorAll('span') ?? []).find((el) => el.textContent === 'Even split')
    expect(variant).toBeTruthy()
    expect(split).toBeTruthy()
    expect(variant?.closest('.sm\\:hidden')).toBeNull()
    expect(split?.closest('.sm\\:hidden')).toBeNull()
    const hiddenFromSm = Array.from(meta?.querySelectorAll(':scope > .sm\\:hidden') ?? [])
    expect(hiddenFromSm).toHaveLength(2)
    expect(hiddenFromSm[0]?.textContent).toContain('Draft')
    expect(hiddenFromSm[1]?.textContent).not.toContain('variants')
    expect(hiddenFromSm[1]?.textContent?.trim().length).toBeGreaterThan(0)
  })

  it('wraps the experiment name instead of truncating it', () => {
    render()
    const name = host.querySelector('.wrap-break-word')
    expect(name?.textContent).toContain('Button colour CTA test with a very long experiment name')
    expect(classTokens(name?.className)).toContain('wrap-break-word')
    expect(classTokens(name?.className)).not.toContain('truncate')
  })

  it('keeps an explicit table mapping when the row is display block', () => {
    render()
    const table = host.querySelector('table')
    expect(table?.getAttribute('role')).toBe('table')
    expect(table?.querySelector('thead')?.getAttribute('role')).toBe('rowgroup')
    expect(table?.querySelector('tbody')?.getAttribute('role')).toBe('rowgroup')
    const headerRow = table?.querySelector('thead tr')
    expect(headerRow?.getAttribute('role')).toBe('row')
    const headers = Array.from(table?.querySelectorAll('th') ?? [])
    expect(headers.length).toBeGreaterThan(0)
    for (const th of headers) expect(th.getAttribute('role')).toBe('columnheader')
    const launch = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Launch')
    const row = launch?.closest('tr')
    expect(row?.getAttribute('role')).toBe('row')
    const cells = Array.from(row?.querySelectorAll(':scope > td') ?? [])
    expect(cells.length).toBeGreaterThan(0)
    for (const td of cells) expect(td.getAttribute('role')).toBe('cell')
  })

  // The unit job does not install a browser. Skip there; run wherever Chromium is present.
  const chromiumBin = (() => {
    try {
      const { chromium } = createRequire(import.meta.url)('playwright') as {
        chromium: { executablePath: () => string }
      }
      const bin = chromium.executablePath()
      return existsSync(bin) ? bin : null
    } catch {
      return null
    }
  })()

  it.skipIf(!chromiumBin)('keeps Launch and the view button inside the card at a 390px viewport', async () => {
    render()
    const table = host.querySelector('table')
    expect(table).toBeTruthy()
    let card: HTMLElement | null = table!.parentElement
    while (card && !classTokens(card.getAttribute('class') ?? '').includes('overflow-hidden')) {
      card = card.parentElement
    }
    expect(card).toBeTruthy()

    const classNames = new Set<string>(['px-4', 'w-full'])
    for (const el of [card!, ...Array.from(card!.querySelectorAll('*'))]) {
      for (const token of classTokens(el.getAttribute('class') ?? '')) classNames.add(token)
    }
    const require = createRequire(import.meta.url)
    const fromVite = createRequire(require.resolve('@tailwindcss/vite'))
    const { compile } = await import(fromVite.resolve('@tailwindcss/node')) as {
      compile: (css: string, options: { base: string, onDependency: () => void }) => Promise<{ build: (candidates: string[]) => string }>
    }
    const compiler = await compile('@import "tailwindcss";\n', {
      base: join(__dirname, '../..'),
      onDependency() {},
    })
    const utilityCss = compiler.build([...classNames])
    const componentCss = readFileSync(join(__dirname, '../styles/components.css'), 'utf8')
    const tableRules = componentCss.match(/\.responsive-table \{[\s\S]*?\.responsive-table-scroll \{[^}]*\}/)
    expect(tableRules?.[0]).toContain('overflow-x: auto')

    const { chromium } = require('playwright') as {
      chromium: { launch: () => Promise<{ newPage: (opts: { viewport: { width: number, height: number } }) => Promise<PwPage>, close: () => Promise<void> }> }
    }
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style><style>:root{--row-py-comfy:0.5rem;--row-py-compact:0.25rem}${tableRules![0]}</style></head><body style="margin:0"><div id="viewport" style="width:390px;overflow:hidden"><div class="w-full px-4">${card!.outerHTML}</div></div></body></html>`, { waitUntil: 'load' })
      const box = await page.evaluate(() => {
        const viewport = document.getElementById('viewport')!
        const cardEl = viewport.querySelector('.overflow-hidden')!
        const launch = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Launch')!
        const view = document.querySelector('button[aria-label^="View experiment"]')!
        const cr = cardEl.getBoundingClientRect()
        const vr = viewport.getBoundingClientRect()
        const lr = launch.getBoundingClientRect()
        const viewBox = view.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(launch)
        const text = range.getBoundingClientRect()
        const inside = (outer: DOMRect, inner: DOMRect) =>
          inner.width > 0 && inner.height > 0
          && inner.left >= outer.left - 0.5
          && inner.right <= outer.right + 0.5
          && inner.top >= outer.top - 0.5
          && inner.bottom <= outer.bottom + 0.5
        return {
          launchText: launch.textContent?.trim() ?? '',
          textWidth: text.width,
          launchInside: inside(cr, lr),
          textInside: inside(cr, text),
          viewInside: inside(cr, viewBox),
          cardInsideViewport: inside(vr, cr),
          scrollOverflow: cardEl.scrollWidth - cardEl.clientWidth,
          viewWidth: viewBox.width,
        }
      })
      const detail = JSON.stringify(box)
      expect(box.launchText, detail).toBe('Launch')
      expect(box.textWidth, detail).toBeGreaterThan(24)
      expect(box.viewWidth, detail).toBeGreaterThan(16)
      expect(box.launchInside, detail).toBe(true)
      expect(box.textInside, detail).toBe(true)
      expect(box.viewInside, detail).toBe(true)
      expect(box.cardInsideViewport, detail).toBe(true)
      expect(box.scrollOverflow, detail).toBeLessThanOrEqual(1)
    } finally {
      await browser.close()
    }
  })
})

interface PwPage {
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
}
