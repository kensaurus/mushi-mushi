/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/integrations/DryRunPanel.test.tsx
 * PURPOSE: The practice-run header keeps "Run dry-run" on one line. At 390px
 *          a side-by-side row squeezed the button to about 58px and the
 *          hyphenated label wrapped onto three lines. Class names miss that:
 *          shared button styles can still wrap or clip the label, and the
 *          integrations page (shell padding, panel, section padding) is
 *          narrower than the viewport. When Chromium is installed the test
 *          renders IntegrationsPage with the admin stylesheet and measures
 *          the line.
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))
// These modules import the unbuilt @mushi-mushi/core package. The dry-run
// button does not use them; stubbing keeps IntegrationsPage renderable here.
vi.mock('../ProjectFavicon', () => ({ ProjectFavicon: () => null }))
vi.mock('../../lib/resolveProjectDomain', () => ({ faviconSourceFromProject: () => ({}) }))
vi.mock('../../lib/track', () => ({ trackAdHoc: () => {}, trackSelf: () => {} }))

import { PAGE_SHELL_CLASS } from '../../lib/pageLayout'
import { apiFetch } from '../../lib/supabase'
import { IntegrationsPage } from '../../pages/IntegrationsPage'
import { DryRunPanel } from './DryRunPanel'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

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
      root.render(createElement(DryRunPanel, { projectId: PROJECT_ID }))
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
    // PageHeaderBar reads the viewport through matchMedia; jsdom has none.
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia
    const fetchMock = apiFetch as unknown as {
      mockImplementation: (fn: (path: string) => Promise<{ ok: boolean, data?: unknown, error?: { message: string } }>) => void
    }
    fetchMock.mockImplementation(async (path) => {
      if (path.startsWith('/v1/admin/integrations/platform')) {
        return { ok: true, data: { platform: {}, sourceByField: {}, canManage: true, organizationId: null } }
      }
      if (path.startsWith('/v1/admin/health/history')) return { ok: true, data: { history: [] } }
      if (path === '/v1/admin/integrations') return { ok: true, data: { integrations: [] } }
      if (path.startsWith('/v1/admin/settings/stats')) {
        return { ok: true, data: { slackConfigured: false, discordConfigured: false, teamsConfigured: false } }
      }
      if (path.startsWith('/v1/admin/repo/repos')) return { ok: true, data: [] }
      return { ok: false, error: { message: 'unused in the dry-run layout check' } }
    })

    await act(async () => {
      root.render(createElement(
        MemoryRouter,
        { initialEntries: [`/integrations/config?project=${PROJECT_ID}`] },
        createElement(
          'main',
          { id: 'main-content', className: 'flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-surface' },
          createElement(
            'div',
            { className: `${PAGE_SHELL_CLASS.standard} pb-20`, 'data-page-width': 'standard' },
            createElement(IntegrationsPage),
          ),
        ),
      ))
    })
    let section: HTMLElement | null = null
    for (let i = 0; i < 40 && !section; i += 1) {
      section = container.querySelector<HTMLElement>('#integrations-codebase')
      if (section?.textContent?.includes('Run dry-run')) break
      section = null
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      })
    }
    const main = container.querySelector('main#main-content')
    expect(main, container.textContent?.slice(0, 400)).toBeTruthy()
    expect(section, container.textContent?.slice(0, 400)).toBeTruthy()

    const classNames = new Set<string>()
    for (const el of [main!, ...Array.from(main!.querySelectorAll('*'))]) {
      for (const token of (el.getAttribute('class') ?? '').split(/\s+/)) {
        if (token) classNames.add(token)
      }
    }
    const stylesheet = await applicationStylesheet([...classNames])
    // Shared rules live in the admin stylesheet (styles/components.css), not in
    // a utility sheet built from the card's class list alone.
    expect(stylesheet).toContain('.panel-section-label')
    expect(stylesheet).toContain('--font-sans')

    const nodeRequire = createRequire(import.meta.url)
    const { chromium } = nodeRequire('playwright') as {
      chromium: { launch: () => Promise<{ newPage: (opts: { viewport: { width: number, height: number } }) => Promise<LayoutPage>, close: () => Promise<void> }> }
    }
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      const css = stylesheet.replace(/<\/style/gi, '<\\/style')
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${main!.outerHTML}</body></html>`,
        { waitUntil: 'load' },
      )
      const fit = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Run dry-run'))!
        const pageEl = document.querySelector('[data-testid="mushi-page-integrations"]')!
        const shell = document.querySelector('[data-page-width="standard"]')!
        const sectionLabel = document.querySelector('.panel-section-label')!
        const box = button.getBoundingClientRect()
        const pageBox = pageEl.getBoundingClientRect()
        const shellBox = shell.getBoundingClientRect()
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
        const horizontallyInside = (outer: DOMRect, inner: DOMRect) =>
          inner.width > 0
          && inner.left >= outer.left - 0.5
          && inner.right <= outer.right + 0.5
        return {
          text: button.textContent?.trim() ?? '',
          inSection: Boolean(button.closest('#integrations-codebase')),
          lines,
          textInside: inside(box, textBox),
          insidePage: inside(pageBox, box),
          insideViewport: horizontallyInside(new DOMRect(0, 0, window.innerWidth, window.innerHeight), box),
          pageNarrowerThanViewport: pageBox.width < window.innerWidth - 8,
          shellFillsViewport: shellBox.width > window.innerWidth - 2,
          viewportWidth: window.innerWidth,
          scrollOverflow: button.scrollWidth - button.clientWidth,
          boxWidth: box.width,
          boxHeight: box.height,
          textWidth: textBox.width,
          whiteSpace: getComputedStyle(button).whiteSpace,
          panelBorder: getComputedStyle(button.closest('.panel')!).borderTopWidth,
          labelTracking: getComputedStyle(sectionLabel).letterSpacing,
          fontFamily: getComputedStyle(document.body).fontFamily,
        }
      })
      const detail = JSON.stringify(fit)
      expect(fit.viewportWidth, detail).toBe(390)
      expect(fit.text, detail).toBe('Run dry-run')
      expect(fit.inSection, detail).toBe(true)
      expect(fit.shellFillsViewport, detail).toBe(true)
      expect(fit.pageNarrowerThanViewport, detail).toBe(true)
      expect(fit.fontFamily, detail).toContain('Inter')
      expect(fit.labelTracking, detail).not.toBe('normal')
      expect(fit.panelBorder, detail).toBe('1px')
      // The reported failure is three lines in a ~58px-wide button.
      expect(fit.lines, detail).toBe(1)
      expect(fit.boxWidth, detail).toBeGreaterThan(80)
      expect(fit.boxHeight, detail).toBeLessThan(48)
      expect(fit.textInside, detail).toBe(true)
      expect(fit.insidePage, detail).toBe(true)
      expect(fit.insideViewport, detail).toBe(true)
      expect(fit.scrollOverflow, detail).toBeLessThanOrEqual(1)
      expect(fit.textWidth, detail).toBeGreaterThan(40)
    } finally {
      await browser.close()
    }
  }, 60_000)
})

/** Admin index.css, including shared component rules, for the classes on screen. */
async function applicationStylesheet(candidates: string[]): Promise<string> {
  const nodeRequire = createRequire(import.meta.url)
  const fromVite = createRequire(nodeRequire.resolve('@tailwindcss/vite'))
  const { compile } = await import(fromVite.resolve('@tailwindcss/node')) as {
    compile: (
      css: string,
      options: { base: string, from?: string, onDependency: () => void },
    ) => Promise<{ build: (candidates: string[]) => string }>
  }
  const adminSrc = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const from = join(adminSrc, 'index.css')
  const compiler = await compile(readFileSync(from, 'utf8'), {
    base: adminSrc,
    from,
    onDependency() {},
  })
  return compiler.build(candidates)
}

interface LayoutPage {
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
}
