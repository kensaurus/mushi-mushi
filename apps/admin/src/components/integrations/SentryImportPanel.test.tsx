/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/SentryImportPanel.test.tsx
 * PURPOSE: The console reaches every Sentry import option the API and MCP
 *          already had: a Sentry project picker (primary + extra slugs), a
 *          "seen in the last N days" choice, and "Load next page" that repeats
 *          the same search with the answer's nextCursor. A fixed 10rem project
 *          menu clips "mushi-mushi-admin". Class names miss that when shared
 *          field styles still cap the control, so when Chromium is installed
 *          the test measures the slug at 1440px.
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => api)
vi.mock('../ProjectSwitcher', () => ({ useActiveProjectId: () => '11111111-1111-4111-8111-111111111111' }))

import { SentryImportPanel } from './SentryImportPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = '11111111-1111-4111-8111-111111111111'

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function page(nextCursor: string | null, shortId: string) {
  return {
    ok: true,
    data: {
      items: [{ input: shortId, issueId: '1', shortId, outcome: 'created', reportId: null }],
      created: ['r1'],
      linked: [],
      failed: 0,
      indexing: { queued: false, paths: 0 },
      sentryProject: 'sbc-be',
      nextCursor,
    },
  }
}

function sentBody(call: number): Record<string, unknown> {
  const init = api.apiFetchMutate.mock.calls[call][1] as { body: string }
  return JSON.parse(init.body) as Record<string, unknown>
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
}

function choose(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('SentryImportPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetchMutate.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(sentryProjects: string[]): Promise<void> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SentryImportPanel, { sentryProjects })))
      await flush()
    })
  }

  it('searches the picked Sentry project for the chosen window and pages with nextCursor', async () => {
    api.apiFetchMutate.mockResolvedValueOnce(page('1700000000:0:0', 'BE-1')).mockResolvedValueOnce(page(null, 'BE-2'))
    await render(['sbc-front', 'sbc-be'])

    const project = container.querySelector<HTMLSelectElement>('select[aria-label="Sentry project"]')!
    const since = container.querySelector<HTMLSelectElement>('select[aria-label="Seen in"]')!
    expect(Array.from(project.options).map((o) => o.value)).toEqual(['sbc-front', 'sbc-be'])
    await act(async () => {
      choose(project, 'sbc-be')
      choose(since, '30')
      await flush()
    })

    await act(async () => {
      buttonByText(container, 'seen in 30d')!.click()
      await flush()
    })
    expect(api.apiFetchMutate.mock.calls[0][0]).toBe(`/v1/admin/projects/${PROJECT}/sentry/import`)
    expect(sentBody(0)).toEqual({ limit: 10, sinceDays: 30, sentryProject: 'sbc-be' })

    const next = buttonByText(container, 'Load next page')
    expect(next).toBeDefined()
    await act(async () => {
      next!.click()
      await flush()
    })
    expect(sentBody(1)).toEqual({ limit: 10, sinceDays: 30, sentryProject: 'sbc-be', cursor: '1700000000:0:0' })
    expect(container.textContent).toContain('Page 2 of sbc-be')
    expect(buttonByText(container, 'Load next page')).toBeUndefined()
    expect(container.textContent).toContain('That was the last page')
  })

  it('sizes the project menu to the slug instead of a 10rem cap', async () => {
    await render(['mushi-mushi-admin', 'mushi-mushi-server'])
    const project = container.querySelector<HTMLSelectElement>('select[aria-label="Sentry project"]')!
    expect(Array.from(project.options).map((o) => o.textContent)).toEqual(['mushi-mushi-admin', 'mushi-mushi-server'])
    expect(project.className).toContain('!w-auto')
    const wrap = project.closest('div')
    expect(wrap?.className).toContain('w-max')
    expect(wrap?.className).toContain('shrink-0')
    expect(wrap?.className).not.toContain('w-40')

    const since = container.querySelector<HTMLSelectElement>('select[aria-label="Seen in"]')!
    expect(since.className).toContain('!w-auto')
    const sinceWrap = since.closest('div')
    expect(sinceWrap?.className).toContain('w-max')
    expect(sinceWrap?.className).not.toContain('w-36')
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

  it.skipIf(!chromiumBin)('shows the full Sentry project slug at a 1440px viewport', async () => {
    await render(['mushi-mushi-admin', 'mushi-mushi-server'])
    const sinceEl = container.querySelector<HTMLSelectElement>('select[aria-label="Seen in"]')!
    await act(async () => {
      choose(sinceEl, '90')
      await flush()
    })
    expect(sinceEl.value).toBe('90')
    let rootEl = container.querySelector('select[aria-label="Sentry project"]')!.parentElement!
    while (rootEl.parentElement && rootEl.parentElement !== container) rootEl = rootEl.parentElement
    const classNames = new Set<string>()
    for (const el of [rootEl, ...Array.from(rootEl.querySelectorAll('*'))]) {
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
    // Unlayered, so it beats Tailwind's text-sm on the select. A 16px slug
    // needs a wider control than the class name test can see.
    const fieldFont = readFileSync(join(adminRoot, 'src/styles/base-and-density.css'), 'utf8')
      .match(/@media \(max-width: 639px\), \(pointer: coarse\) \{[\s\S]*?\n\}/)?.[0]
    expect(fieldFont).toContain('font-size: 16px')
    if (!fieldFont) throw new Error('shared field font rule missing')

    const { chromium } = nodeRequire('playwright') as {
      chromium: { launch: () => Promise<{ newPage: (opts: { viewport: { width: number, height: number } }) => Promise<LayoutPage>, close: () => Promise<void> }> }
    }
    const browser = await chromium.launch()
    try {
      // jsdom keeps the controlled value on the property and omits it from
      // outerHTML, so the static page would otherwise show the first option.
      for (const select of rootEl.querySelectorAll('select')) {
        const chosen = select.selectedIndex
        for (let i = 0; i < select.options.length; i += 1) {
          select.options[i]!.toggleAttribute('selected', i === chosen)
        }
      }
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style><style>${fieldFont}</style></head><body style="margin:0"><div id="viewport" style="width:1440px">${rootEl.outerHTML}</div></body></html>`,
        { waitUntil: 'load' },
      )
      const fit = await page.evaluate(() => {
        const viewport = document.getElementById('viewport')!
        const view = viewport.getBoundingClientRect()
        function textWidth(text: string, style: CSSStyleDeclaration): number {
          const probe = document.createElement('span')
          probe.textContent = text
          probe.style.position = 'absolute'
          probe.style.visibility = 'hidden'
          probe.style.whiteSpace = 'nowrap'
          probe.style.font = style.font
          probe.style.letterSpacing = style.letterSpacing
          document.body.appendChild(probe)
          const width = probe.getBoundingClientRect().width
          probe.remove()
          return width
        }
        // Padding, border and the native menu arrow, measured on a one-letter
        // select that shares the field's classes. A 10rem cap fails this;
        // a control sized to the slug does not.
        function selectChrome(el: HTMLSelectElement): number {
          const sample = el.cloneNode(false) as HTMLSelectElement
          sample.className = el.className
          const option = document.createElement('option')
          option.textContent = 'i'
          sample.appendChild(option)
          sample.style.position = 'absolute'
          sample.style.left = '-9999px'
          sample.style.width = 'auto'
          sample.style.maxWidth = 'none'
          document.body.appendChild(sample)
          const chrome = sample.getBoundingClientRect().width - textWidth('i', getComputedStyle(sample))
          sample.remove()
          return chrome
        }
        function measure(label: string) {
          const el = viewport.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
          const style = getComputedStyle(el)
          const text = el.options[el.selectedIndex]?.text ?? ''
          const needed = textWidth(text, style) + selectChrome(el)
          const box = el.getBoundingClientRect()
          return {
            text,
            needed,
            boxWidth: box.width,
            labelFits: box.width + 1 >= needed,
            insideViewport: box.width > 0 && box.left >= view.left - 0.5 && box.right <= view.right + 0.5,
            whiteSpace: style.whiteSpace,
          }
        }
        return {
          project: measure('Sentry project'),
          since: measure('Seen in'),
        }
      })
      const detail = JSON.stringify(fit)
      expect(fit.project.text, detail).toBe('mushi-mushi-admin')
      expect(fit.project.labelFits, detail).toBe(true)
      expect(fit.project.insideViewport, detail).toBe(true)
      expect(fit.since.text, detail).toBe('Seen in last 90 days')
      expect(fit.since.labelFits, detail).toBe(true)
      expect(fit.since.insideViewport, detail).toBe(true)
    } finally {
      await browser.close()
    }
  })

  it('hides the picker for a single Sentry project and the search options while ids are typed', async () => {
    api.apiFetchMutate.mockResolvedValueOnce(page(null, 'WEB-12'))
    await render(['web'])
    expect(container.querySelector('select[aria-label="Sentry project"]')).toBeNull()
    expect(container.querySelector('select[aria-label="Seen in"]')).not.toBeNull()

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Sentry issue ids"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'WEB-12')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await flush()
    })
    expect(container.querySelector('select[aria-label="Seen in"]')).toBeNull()
    await act(async () => {
      buttonByText(container, 'Import 1')!.click()
      await flush()
    })
    expect(sentBody(0)).toEqual({ issueIds: ['WEB-12'] })
    expect(buttonByText(container, 'Load next page')).toBeUndefined()
  })

  // jsdom has no layout, so the alignment contract is checked on the classes:
  // the import button is as tall as the fields next to it, and the row aligns
  // tops so the input's error line cannot drop the button out of the row.
  it('sizes the import button to the field height', async () => {
    await render(['web'])
    const button = buttonByText(container, 'Import newest')!
    expect(button.className).toContain('h-[2.125rem]')
    const row = button.parentElement!
    expect(row.className).toContain('items-start')
    expect(row.className).not.toContain('items-end')
  })
})

interface LayoutPage {
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
}
