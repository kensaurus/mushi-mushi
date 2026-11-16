/**
 * @vitest-environment jsdom
 *
 * Tester home (/admin/tester): the Accepted stat card is the one tile in
 * the row with no link, so its (i) used to sit inline after the label while
 * Balance, Total earned and Apps joined parked theirs at the right edge.
 * The wallet strip is plain-only and must keep the icon beside the label.
 *
 * The geometry check runs in the default vitest file (not an opt-in suite)
 * whenever Playwright's Chromium is installed, at 1440x900 and 390x844.
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/useTesterStatus', () => ({
  REP_TIERS: [
    { name: 'Platinum', min: 200, color: 'text-info-foreground', bg: 'bg-info-muted border-info/30' },
    { name: 'Gold', min: 75, color: 'text-warn-foreground', bg: 'bg-warn-muted border-warn/30' },
    { name: 'Silver', min: 25, color: 'text-fg-secondary', bg: 'bg-surface-overlay border-edge' },
    { name: 'Bronze', min: 0, color: 'text-brand', bg: 'bg-brand-subtle border-brand/30' },
  ],
  reputationTier: (score: number) => {
    const tiers = [
      { name: 'Platinum', min: 200, color: 'text-info-foreground', bg: 'bg-info-muted border-info/30' },
      { name: 'Gold', min: 75, color: 'text-warn-foreground', bg: 'bg-warn-muted border-warn/30' },
      { name: 'Silver', min: 25, color: 'text-fg-secondary', bg: 'bg-surface-overlay border-edge' },
      { name: 'Bronze', min: 0, color: 'text-brand', bg: 'bg-brand-subtle border-brand/30' },
    ]
    return tiers.find((t) => score >= t.min) ?? tiers[tiers.length - 1]
  },
  useTesterStatus: () => ({
    data: {
      isTester: true,
      handle: 'Ada',
      reputation: 40,
      balance: 1240,
      totalEarned: 3180,
      totalRedeemed: 0,
      acceptedSubmissions: 27,
      joinedApps: 4,
    },
    loading: false,
    error: null,
    reload: () => {},
  }),
  refreshTesterStatus: () => {},
}))

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: null, loading: false, error: null, reload: () => {} }),
}))

import { TesterStatGrid, type TesterStatItem } from '../../components/tester/tester-ui'
import { TesterHomePage } from './TesterHomePage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Content column: sidebar w-60 at md+, page shell px-5 (sm+) or px-4. */
const COLUMN_AT_1440 = 1440 - 240 - 40
const COLUMN_AT_390 = 390 - 32

const PLAIN_ROW: TesterStatItem[] = [
  { label: 'Balance', value: '1,240 pts', hint: 'redeemable now' },
  { label: 'Total earned', value: '3,180 pts', hint: 'all time' },
  { label: 'Total redeemed', value: '0 pts', hint: 'all time' },
  { label: 'YTD gift cards', value: '$0.00', hint: 'of $599 cap' },
]

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

function renderHome() {
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/tester'] }, createElement(TesterHomePage)))
  })
}

function statGroup(): HTMLElement {
  const group = host.querySelector<HTMLElement>('[aria-label="Tester account stats"]')
  expect(group).not.toBeNull()
  return group!
}

describe('TesterHomePage stat row', () => {
  it('reserves the arrow slot on Accepted and not on a plain-only strip', () => {
    renderHome()
    const accepted = statGroup().querySelector<HTMLElement>('span[title="Accepted"]')
    expect(accepted).not.toBeNull()
    expect(accepted!.className).toContain('flex-1')
    const card = accepted!.closest('.card-elevated')
    expect(card?.querySelector('span.h-3.w-3')).not.toBeNull()
    const balance = statGroup().querySelector('a[href="/tester/wallet"]')
    expect(balance?.querySelector('.stat-card-arrow')).not.toBeNull()

    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(TesterStatGrid, { items: PLAIN_ROW })))
    })
    const plain = host.querySelector<HTMLElement>('span[title="Balance"]')
    expect(plain).not.toBeNull()
    expect(plain!.className).not.toContain('flex-1')
    expect(host.querySelector('span.h-3.w-3')).toBeNull()
  })

  it.skipIf(!chromiumBin)('lines the four (i) icons up at 1440x900 and 390x844', async () => {
    renderHome()
    const home = statGroup().outerHTML
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(TesterStatGrid, { items: PLAIN_ROW })))
    })
    const plain = statGroup().outerHTML

    const classNames = new Set<string>()
    for (const html of [home, plain]) {
      for (const match of html.matchAll(/class="([^"]*)"/g)) {
        for (const token of match[1].split(/\s+/)) if (token) classNames.add(token)
      }
    }
    const require = createRequire(import.meta.url)
    const fromVite = createRequire(require.resolve('@tailwindcss/vite'))
    const { compile } = await import(fromVite.resolve('@tailwindcss/node')) as {
      compile: (css: string, options: { base: string, onDependency: () => void }) => Promise<{ build: (candidates: string[]) => string }>
    }
    const compiler = await compile('@import "tailwindcss";\n', {
      base: join(__dirname, '../../..'),
      onDependency() {},
    })
    const utilityCss = compiler.build([...classNames])

    const { chromium } = require('playwright') as {
      chromium: {
        launch: () => Promise<{
          newPage: (opts: { viewport: { width: number, height: number } }) => Promise<PwPage>
          close: () => Promise<void>
        }>
      }
    }
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const cases = [
        { name: '1440x900', viewport: { width: 1440, height: 900 }, column: COLUMN_AT_1440 },
        { name: '390x844', viewport: { width: 390, height: 844 }, column: COLUMN_AT_390 },
      ]
      for (const { name, viewport, column } of cases) {
        await page.setViewportSize(viewport)
        const measure = async (markup: string) => {
          await page.setContent(
            `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style></head><body style="margin:0"><div id="column" style="width:${column}px">${markup}</div></body></html>`,
            { waitUntil: 'load' },
          )
          return page.evaluate(() => {
            const cards = [...document.querySelectorAll('.card-elevated')]
            return cards.map((card) => {
              const help = card.querySelector('button')
              if (!help) throw new Error('stat card rendered without its help trigger')
              const cardBox = card.getBoundingClientRect()
              const helpBox = help.getBoundingClientRect()
              const swap = card.querySelector('.stat-card-swap-primary')
              const plainLabel = card.querySelector('span[title]')
              return {
                label: (swap?.textContent ?? plainLabel?.getAttribute('title') ?? '').trim(),
                helpInset: cardBox.right - helpBox.right,
                cardWidth: cardBox.width,
                inside: helpBox.left >= cardBox.left - 0.5 && helpBox.right <= cardBox.right + 0.5,
              }
            })
          })
        }
        const mixed = await measure(home)
        const plainRow = await measure(plain)
        const detail = JSON.stringify({ name, mixed, plainRow })
        expect(mixed.map((c) => c.label), detail).toEqual(['Balance', 'Total earned', 'Apps joined', 'Accepted'])
        expect(new Set(mixed.map((c) => Math.round(c.cardWidth))).size, detail).toBe(1)
        const insets = mixed.map((c) => c.helpInset)
        expect(Math.max(...insets) - Math.min(...insets), detail).toBeLessThanOrEqual(1)
        for (const card of mixed) {
          expect(card.inside, detail).toBe(true)
          expect(card.helpInset, detail).toBeLessThan(36)
          expect(card.helpInset, detail).toBeGreaterThan(8)
        }
        const plainAccepted = plainRow.find((c) => c.label === 'Balance')
        const mixedAccepted = mixed.find((c) => c.label === 'Accepted')
        expect(plainAccepted, detail).toBeDefined()
        expect(plainAccepted!.helpInset, detail).toBeGreaterThan(mixedAccepted!.helpInset + 16)
      }
    } finally {
      await browser.close()
    }
  })
})

interface PwPage {
  setViewportSize: (size: { width: number, height: number }) => Promise<void>
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
}
