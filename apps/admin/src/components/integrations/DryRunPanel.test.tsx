/**
 * FILE: apps/admin/src/components/integrations/DryRunPanel.test.tsx
 * PURPOSE: The Practice run header stacks below sm so "Run dry-run" stays
 *          one line at a 390px viewport (report 5e3667fa). jsdom only sees
 *          classes; the Chromium check measures the label when a browser
 *          is installed.
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))

import { DryRunPanel } from './DryRunPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function classTokens(className: string | null | undefined): string[] {
  return (className ?? '').split(/\s+/).filter(Boolean)
}

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
    root.render(createElement(DryRunPanel, { projectId: 'p1' }))
  })
}

function dryRunButton(): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Run dry-run')
}

describe('DryRunPanel at phone width', () => {
  it('stacks the header below sm and refuses to wrap the dry-run label', () => {
    render()
    const button = dryRunButton()
    expect(button).toBeTruthy()
    expect(classTokens(button?.className)).toEqual(
      expect.arrayContaining(['shrink-0', 'self-start', 'whitespace-nowrap', 'sm:self-auto']),
    )
    const header = button?.parentElement
    expect(classTokens(header?.className)).toEqual(
      expect.arrayContaining(['flex-col', 'sm:flex-row', 'sm:items-center', 'sm:justify-between']),
    )
    expect(classTokens(header?.querySelector('h4')?.parentElement?.className)).toContain('min-w-0')
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

  it.skipIf(!chromiumBin)('keeps Run dry-run on one line inside a 390px page', async () => {
    render()
    const card = host.firstElementChild as HTMLElement
    expect(card).toBeTruthy()
    const classNames = new Set<string>(['p-4', 'w-full'])
    for (const el of [card, ...Array.from(card.querySelectorAll('*'))]) {
      for (const token of classTokens(el.getAttribute('class'))) classNames.add(token)
    }
    const nodeRequire = createRequire(import.meta.url)
    const fromVite = createRequire(nodeRequire.resolve('@tailwindcss/vite'))
    const { compile } = await import(fromVite.resolve('@tailwindcss/node')) as {
      compile: (css: string, options: { base: string, onDependency: () => void }) => Promise<{ build: (candidates: string[]) => string }>
    }
    const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
    const compiler = await compile('@import "tailwindcss";\n', {
      base: adminRoot,
      onDependency() {},
    })
    const utilityCss = compiler.build([...classNames])
    // text-2xs is an app token (0.75rem), not a default Tailwind size. The
    // description uses it, so the measurement has to as well.
    const text2xs = '.text-2xs{font-size:0.75rem;line-height:1rem}'

    const { chromium } = nodeRequire('playwright') as {
      chromium: { launch: () => Promise<{ newPage: (opts: { viewport: { width: number, height: number } }) => Promise<PwPage>, close: () => Promise<void> }> }
    }
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}${text2xs}</style></head><body style="margin:0"><div id="viewport" style="width:390px;overflow:hidden"><div class="w-full p-4">${card.outerHTML}</div></div></body></html>`,
        { waitUntil: 'load' },
      )
      const box = await page.evaluate(() => {
        const viewport = document.getElementById('viewport')!
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Run dry-run')!
        const header = button.parentElement!
        const cardEl = header.parentElement!
        const range = document.createRange()
        range.selectNodeContents(button)
        const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
        const br = button.getBoundingClientRect()
        const cr = cardEl.getBoundingClientRect()
        const vr = viewport.getBoundingClientRect()
        const inside = (outer: DOMRect, inner: DOMRect) =>
          inner.width > 0 && inner.height > 0
          && inner.left >= outer.left - 0.5
          && inner.right <= outer.right + 0.5
          && inner.top >= outer.top - 0.5
          && inner.bottom <= outer.bottom + 0.5
        return {
          label: button.textContent?.trim() ?? '',
          whiteSpace: getComputedStyle(button).whiteSpace,
          flexDirection: getComputedStyle(header).flexDirection,
          buttonWidth: br.width,
          lineCount: lines.length,
          buttonInsideCard: inside(cr, br),
          cardInsideViewport: inside(vr, cr),
        }
      })
      const detail = JSON.stringify(box)
      expect(box.label, detail).toBe('Run dry-run')
      expect(box.whiteSpace, detail).toBe('nowrap')
      expect(box.flexDirection, detail).toBe('column')
      expect(box.lineCount, detail).toBe(1)
      expect(box.buttonWidth, detail).toBeGreaterThan(80)
      expect(box.buttonInsideCard, detail).toBe(true)
      expect(box.cardInsideViewport, detail).toBe(true)
    } finally {
      await browser.close()
    }
  })
})

interface PwPage {
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
}
