/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/integrations/DryRunPanel.test.tsx
 * PURPOSE: The practice-run header keeps "Run dry-run" on one line. At 390px
 *          a side-by-side row squeezed the button to about 58px and the
 *          hyphenated label wrapped onto three lines. Class names miss that:
 *          shared button styles can still wrap or clip the label, so when
 *          Chromium is installed the test measures the rendered line.
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

describe('DryRunPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('stacks the practice run below sm and keeps the dry-run label on one line', async () => {
    await act(async () => {
      root.render(createElement(DryRunPanel, { projectId: '11111111-1111-4111-8111-111111111111' }))
    })

    const button = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes('Run dry-run'))
    expect(button).toBeTruthy()
    expect(button?.className).toContain('shrink-0')
    expect(button?.className).toContain('whitespace-nowrap')

    const row = button?.parentElement
    expect(row?.className).toContain('flex-col')
    expect(row?.className).toContain('sm:flex-row')
    expect(row?.className).toContain('sm:items-center')
    expect(row?.querySelector('div')?.className).toContain('min-w-0')
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

  it.skipIf(!chromiumBin)('keeps the dry-run label on one unclipped line at a 390px viewport', async () => {
    await act(async () => {
      root.render(createElement(DryRunPanel, { projectId: '11111111-1111-4111-8111-111111111111' }))
    })
    const card = container.firstElementChild as HTMLElement
    const classNames = new Set<string>()
    for (const el of [card, ...Array.from(card.querySelectorAll('*'))]) {
      for (const token of (el.getAttribute('class') ?? '').split(/\s+/)) {
        if (token) classNames.add(token)
      }
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

    const { chromium } = nodeRequire('playwright') as {
      chromium: { launch: () => Promise<{ newPage: (opts: { viewport: { width: number, height: number } }) => Promise<LayoutPage>, close: () => Promise<void> }> }
    }
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style></head><body style="margin:0"><div id="viewport" style="width:390px">${card.outerHTML}</div></body></html>`,
        { waitUntil: 'load' },
      )
      const fit = await page.evaluate(() => {
        const viewport = document.getElementById('viewport')!
        const button = [...viewport.querySelectorAll('button')].find((el) => el.textContent?.includes('Run dry-run'))!
        const box = button.getBoundingClientRect()
        const view = viewport.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(button)
        const rects = [...range.getClientRects()]
        const textBox = range.getBoundingClientRect()
        const lines = new Set(rects.map((r) => Math.round(r.top))).size
        const inside = (outer: DOMRect, inner: DOMRect) =>
          inner.width > 0 && inner.height > 0
          && inner.left >= outer.left - 0.5
          && inner.right <= outer.right + 0.5
          && inner.top >= outer.top - 0.5
          && inner.bottom <= outer.bottom + 0.5
        return {
          text: button.textContent?.trim() ?? '',
          lines,
          textInside: inside(box, textBox),
          insideViewport: inside(view, box),
          scrollOverflow: button.scrollWidth - button.clientWidth,
          boxWidth: box.width,
          boxHeight: box.height,
          textWidth: textBox.width,
          whiteSpace: getComputedStyle(button).whiteSpace,
        }
      })
      const detail = JSON.stringify(fit)
      expect(fit.text, detail).toBe('Run dry-run')
      // The reported failure is three lines in a ~58px-tall button.
      expect(fit.lines, detail).toBe(1)
      expect(fit.boxHeight, detail).toBeLessThan(48)
      expect(fit.textInside, detail).toBe(true)
      expect(fit.insideViewport, detail).toBe(true)
      expect(fit.scrollOverflow, detail).toBeLessThanOrEqual(1)
      expect(fit.textWidth, detail).toBeGreaterThan(40)
    } finally {
      await browser.close()
    }
  })
})

interface LayoutPage {
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
}
