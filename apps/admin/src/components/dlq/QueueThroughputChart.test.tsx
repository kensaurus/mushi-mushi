/**
 * FILE: apps/admin/src/components/dlq/QueueThroughputChart.test.tsx
 * PURPOSE: The daily-throughput date range must not break inside a date.
 *          At 390px the range "2026-10-13 → 2026-10-26" was wrapping after
 *          the last hyphen. nowrap keeps the range intact; flex-wrap lets
 *          that whole group drop under the title when the card is narrow.
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueueThroughputChart } from './QueueThroughputChart'
import type { ThroughputDay } from './types'

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

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

function days(): ThroughputDay[] {
  const out: ThroughputDay[] = []
  for (let day = 13; day <= 26; day++) {
    out.push({
      day: `2026-10-${String(day).padStart(2, '0')}`,
      created: 1,
      completed: 1,
      failed: 0,
    })
  }
  return out
}

describe('QueueThroughputChart date range', () => {
  it('keeps the ISO range on one line and lets the header wrap as a group', () => {
    act(() => {
      root.render(createElement(QueueThroughputChart, { throughput: days() }))
    })
    const range = [...host.querySelectorAll('span')].find((el) => el.textContent?.includes('→'))
    expect(range?.textContent).toBe('2026-10-13 → 2026-10-26')
    expect(range?.className.split(/\s+/)).toContain('whitespace-nowrap')
    expect(range?.parentElement?.className.split(/\s+/)).toContain('shrink-0')
    expect(range?.parentElement?.parentElement?.className.split(/\s+/)).toContain('flex-wrap')
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

  it.skipIf(!chromiumBin)('keeps the date range intact inside a 390px card', async () => {
    act(() => {
      root.render(createElement(QueueThroughputChart, { throughput: days() }))
    })
    const card = host.firstElementChild as HTMLElement
    expect(card).toBeTruthy()

    const classNames = new Set<string>(['px-4', 'w-full'])
    for (const el of [card, ...Array.from(card.querySelectorAll('*'))]) {
      for (const token of (el.getAttribute('class') ?? '').split(/\s+/)) {
        if (token) classNames.add(token)
      }
    }
    const require = createRequire(import.meta.url)
    const fromVite = createRequire(require.resolve('@tailwindcss/vite'))
    const { compile } = await import(fromVite.resolve('@tailwindcss/node')) as {
      compile: (css: string, options: { base: string, onDependency: () => void }) => Promise<{ build: (candidates: string[]) => string }>
    }
    const compiler = await compile('@import "tailwindcss";\n@import "./src/styles/theme-tokens.css";\n', {
      base: adminRoot,
      onDependency() {},
    })
    const utilityCss = compiler.build([...classNames])

    const { chromium } = require('playwright') as {
      chromium: { launch: () => Promise<{ newPage: (opts: { viewport: { width: number, height: number } }) => Promise<PwPage>, close: () => Promise<void> }> }
    }
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style></head><body style="margin:0"><div id="viewport" style="width:390px"><div class="w-full px-4">${card.outerHTML}</div></div></body></html>`,
        { waitUntil: 'load' },
      )
      const box = await page.evaluate(() => {
        const viewport = document.getElementById('viewport')!
        const cardEl = viewport.querySelector('.p-3')!
        const range = [...cardEl.querySelectorAll('span')].find((el) => el.textContent?.includes('→'))!
        const rects = range.getClientRects()
        const rangeBox = range.getBoundingClientRect()
        const cardBox = cardEl.getBoundingClientRect()
        const viewBox = viewport.getBoundingClientRect()
        return {
          text: range.textContent,
          lines: rects.length,
          rangeRight: rangeBox.right,
          cardRight: cardBox.right,
          rangeLeft: rangeBox.left,
          cardLeft: cardBox.left,
          cardPastViewport: cardBox.right - viewBox.right,
          headerOverflow: (range.parentElement?.parentElement?.scrollWidth ?? 0) - (range.parentElement?.parentElement?.clientWidth ?? 0),
        }
      })
      const detail = JSON.stringify(box)
      expect(box.text, detail).toBe('2026-10-13 → 2026-10-26')
      expect(box.lines, detail).toBe(1)
      expect(box.rangeLeft, detail).toBeGreaterThanOrEqual(box.cardLeft - 0.5)
      expect(box.rangeRight, detail).toBeLessThanOrEqual(box.cardRight + 0.5)
      expect(box.cardPastViewport, detail).toBeLessThanOrEqual(1)
      expect(box.headerOverflow, detail).toBeLessThanOrEqual(1)
    } finally {
      await browser.close()
    }
  })
})

interface PwPage {
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
}
