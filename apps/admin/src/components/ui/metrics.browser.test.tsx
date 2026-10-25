/**
 * FILE: apps/admin/src/components/ui/metrics.browser.test.tsx
 * PURPOSE: Prove in a real browser that a StatCard row's (i) help icons share
 *          an x position — the alignment claim metrics.test.tsx cannot make.
 *
 * OVERVIEW:
 * - metrics.test.tsx asserts class names and child counts under jsdom, which
 *   does no layout: it can show the markup changed, never that the icons line
 *   up. This suite renders the real `TesterStatGrid` (what /admin/tester puts
 *   on screen) into Chromium with the app's real Tailwind utilities and
 *   components.css, then compares bounding boxes at the two viewports the bug
 *   report names as done criteria: 1440x900 and 390x844.
 * - The defect is a row that mixes linked and plain cards: on /admin/tester,
 *   "Balance" / "Total earned" / "Apps joined" link out and carry an arrow,
 *   "Accepted" does not. Without the fix in StatCard the plain card's (i) sits
 *   inline after its label while the other three sit at the card's right edge.
 *
 * DEPENDENCIES:
 * - playwright (chromium) — same opt-in harness shape as packages/ux's
 *   `*.browser.test.ts` suites
 * - tailwindcss v4's programmatic `compile()` so the fixture gets the app's own
 *   utility CSS instead of a hand-written stand-in
 *
 * USAGE:
 * - Opt-in: `MUSHI_ADMIN_BROWSER_TESTS=1 pnpm --filter @mushi-mushi/admin test`
 *   (vitest.config.ts excludes `*.browser.test.tsx` otherwise, so CI needs no
 *   browser download).
 *
 * NOTES:
 * - Assertions are relative — each icon's inset from its own card's right edge
 *   — so they are independent of font metrics, column count and viewport.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TesterStatGrid, type TesterStatItem } from '../tester/tester-ui'

const enabled = process.env.MUSHI_ADMIN_BROWSER_TESTS === '1'

// `import.meta.url` is not a file: URL under vitest's transform, so anchor on
// the workspace root vitest runs from instead.
const APP_DIR = process.cwd()
const SRC_DIR = path.join(APP_DIR, 'src')

/** The two widths the report's done criteria name. */
const VIEWPORTS = [
  { name: '1440x900 (desktop)', width: 1440, height: 900 },
  { name: '390x844 (mobile)', width: 390, height: 844 },
] as const

/** The exact stat row TesterHomePage renders: three linked cards, one plain. */
const TESTER_ROW: TesterStatItem[] = [
  { label: 'Balance', value: '1,240 pts', hint: 'redeemable now', accent: 'text-brand', to: '/tester/wallet' },
  { label: 'Total earned', value: '3,180 pts', hint: 'all time', to: '/tester/wallet' },
  { label: 'Apps joined', value: '4', hint: 'active programs', to: '/tester/apps' },
  { label: 'Accepted', value: '27', hint: 'all-time reports' },
]

/**
 * The same row with no links — the shape /tester/wallet and the snapshot strips
 * on Projects, Members, Rewards and Portfolio use.
 */
const PLAIN_ROW: TesterStatItem[] = TESTER_ROW.map(({ to: _to, ...rest }) => rest)

/**
 * The app's own CSS, not a stand-in: Tailwind v4 compiled over the candidates
 * the markup actually carries, plus the theme tokens and components.css that
 * `index.css` pulls in. Package `@import`s (tw-animate-css, brand, marketing-ui)
 * are skipped — none of them styles a stat card.
 */
async function buildCss(markup: string): Promise<string> {
  const { compile } = await import('tailwindcss')
  const req = createRequire(path.join(APP_DIR, 'package.json'))
  const entry = ['@import "tailwindcss";', '@import "./styles/theme-tokens.css";', '@import "./styles/components.css";'].join(
    '\n',
  )
  const compiler = await compile(entry, {
    base: SRC_DIR,
    async loadStylesheet(id: string, base: string) {
      const file = id.startsWith('.')
        ? path.resolve(base, id)
        : req.resolve(`${id}/index.css`, { paths: [base] })
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') }
    },
    async loadModule() {
      throw new Error('the stat-card fixture needs no JS plugins')
    },
  })
  const candidates = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
  return compiler.build([...new Set(candidates)])
}

interface CardGeometry {
  label: string
  /** Distance from the card's right edge to the help icon's right edge. */
  helpInset: number
  cardWidth: number
}

describe.skipIf(!enabled)('StatCard help-icon alignment (real layout)', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  async function measure(
    items: TesterStatItem[],
    viewport: { width: number; height: number },
  ): Promise<CardGeometry[]> {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TesterStatGrid items={items} />
      </MemoryRouter>,
    )
    const css = await buildCss(markup)
    const page = await (await browser.newContext({ viewport })).newPage()
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stat row</title>
         <style>${css}</style></head><body><div style="padding:16px">${markup}</div></body></html>`,
      )
      return await page.$$eval('.card-elevated', (cards) =>
        cards.map((card) => {
          const help = card.querySelector('button[aria-label]')
          if (!help) throw new Error('a stat card rendered without its help trigger')
          const cardBox = card.getBoundingClientRect()
          const helpBox = help.getBoundingClientRect()
          const swap = card.querySelector('.stat-card-swap-primary')
          const plain = card.querySelector('span[title]')
          return {
            label: (swap?.textContent ?? plain?.getAttribute('title') ?? '').trim(),
            helpInset: cardBox.right - helpBox.right,
            cardWidth: cardBox.width,
          }
        }),
      )
    } finally {
      await page.context().close()
    }
  }

  for (const viewport of VIEWPORTS) {
    it(`puts every (i) at the same x in the /admin/tester row at ${viewport.name}`, async () => {
      const cards = await measure(TESTER_ROW, viewport)
      expect(cards.map((c) => c.label)).toEqual(['Balance', 'Total earned', 'Apps joined', 'Accepted'])
      // Equal columns, so an equal inset really is an equal x.
      expect(new Set(cards.map((c) => Math.round(c.cardWidth))).size).toBe(1)

      // "Accepted" is the plain card; the other three carry the link arrow.
      const insets = cards.map((c) => c.helpInset)
      for (const inset of insets) expect(inset).toBeCloseTo(insets[0], 0)
      // Right-aligned, not inline after the label: the icon sits within the
      // arrow slot + card padding of the edge, whatever the label's width.
      for (const inset of insets) expect(inset).toBeLessThan(32)
    })

    it(`keeps the (i) right-aligned on a plain-only row at ${viewport.name}`, async () => {
      // StatCard is shared, so a page with no linked cards at all gets the
      // wider label and the reserved arrow slot too. Those rows must land on
      // the same inset as a mixed row, or the fix trades one misalignment for
      // another on every other page.
      const plain = await measure(PLAIN_ROW, viewport)
      const mixed = await measure(TESTER_ROW, viewport)
      expect(new Set(plain.map((c) => Math.round(c.cardWidth))).size).toBe(1)
      const insets = plain.map((c) => c.helpInset)
      for (const inset of insets) expect(inset).toBeCloseTo(insets[0], 0)
      expect(insets[0]).toBeCloseTo(mixed[0].helpInset, 0)
    })
  }
})
