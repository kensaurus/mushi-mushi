/**
 * FILE: apps/admin/src/pages/ResearchPage.test.tsx
 * PURPOSE: The web-query field must show its full placeholder at a 1440px
 *          console (report ed2b1223). Input applies className to the <input>,
 *          so growth has to live on the form's flex item, not the control.
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_RESEARCH_STATS } from '../components/research/ResearchStatsTypes'

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const idle = {
      loading: false,
      error: null,
      errorCode: null,
      reload: () => {},
      lastFetchedAt: null,
      isValidating: false,
    }
    if (path?.includes('/research/stats')) {
      return {
        ...idle,
        data: {
          ...EMPTY_RESEARCH_STATS,
          hasAnyProject: true,
          projectId: 'p1',
          projectName: 'App',
          firecrawlConfigured: true,
          firecrawlReady: true,
          topPriority: 'ready_no_sessions',
        },
      }
    }
    return { ...idle, data: null }
  },
}))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({ activeProject: { project_name: 'App' } }),
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/track', () => ({ trackSelf: vi.fn(), trackAdHoc: vi.fn() }))
vi.mock('../components/PagePosture', () => ({
  PagePosture: () => null,
  POSTURE_PRIORITY: { status: 0, heroOrSnapshot: 1 },
}))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ children }: { children?: unknown }) => createElement('div', null, children as never),
}))

import { ResearchPage } from './ResearchPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Content column at a 1440px viewport: sidebar w-60 (240px) + page px-5 (40px). */
const CONTENT_AT_1440 = 1440 - 240 - 40

const PLACEHOLDER = 'error signature, library name, doc topic…'

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
    root.render(createElement(MemoryRouter, { initialEntries: ['/research'] }, createElement(ResearchPage)))
  })
}

function classTokens(className: string | null): string[] {
  return (className ?? '').split(/\s+/).filter(Boolean)
}

/** The form's flex item that owns the web-query control. */
function queryFlexItem(): HTMLElement {
  const input = host.querySelector<HTMLInputElement>(`input[placeholder="${PLACEHOLDER}"]`)
  expect(input).toBeTruthy()
  const form = input!.closest('form')
  expect(form).toBeTruthy()
  let el: HTMLElement = input!
  while (el.parentElement && el.parentElement !== form) el = el.parentElement
  return el
}

describe('ResearchPage web query', () => {
  it('grows the field in the search row so the placeholder is not stuck at the input intrinsic width', () => {
    render()
    const item = queryFlexItem()
    const tokens = classTokens(item.className)
    expect(tokens).toContain('flex-1')
    expect(tokens).toContain('min-w-0')
  })

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

  it.skipIf(!chromiumBin)('shows the full placeholder in the content column at 1440px', async () => {
    render()
    const form = host.querySelector('form')
    expect(form).toBeTruthy()
    const classNames = new Set<string>(['w-full'])
    for (const el of [form!, ...Array.from(form!.querySelectorAll('*'))]) {
      for (const token of classTokens(el.getAttribute('class'))) classNames.add(token)
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
      // Phone has no sidebar; px-4 leaves 358px and sm:flex-row is off.
      const cases = [
        { viewport: 1440, column: CONTENT_AT_1440 },
        { viewport: 390, column: 390 - 32 },
      ]
      for (const { viewport, column } of cases) {
        await page.setViewportSize({ width: viewport, height: 900 })
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style></head><body style="margin:0"><div id="column" style="width:${column}px">${form!.outerHTML}</div></body></html>`,
          { waitUntil: 'load' },
        )
        const box = await page.evaluate((placeholder) => {
          const input = document.querySelector('input') as HTMLInputElement
          const column = document.getElementById('column')!
          const cs = getComputedStyle(input)
          const probe = document.createElement('span')
          probe.textContent = placeholder
          probe.style.position = 'absolute'
          probe.style.visibility = 'hidden'
          probe.style.whiteSpace = 'pre'
          probe.style.font = cs.font
          probe.style.letterSpacing = cs.letterSpacing
          document.body.appendChild(probe)
          const textWidth = probe.getBoundingClientRect().width
          probe.remove()
          const available = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
          const ir = input.getBoundingClientRect()
          const cr = column.getBoundingClientRect()
          return {
            textWidth,
            available,
            fits: textWidth <= available + 0.5,
            inside: ir.left >= cr.left - 0.5 && ir.right <= cr.right + 0.5,
            inputWidth: ir.width,
            columnWidth: cr.width,
          }
        }, PLACEHOLDER)
        const detail = JSON.stringify(box)
        expect(box.fits, detail).toBe(true)
        expect(box.inside, detail).toBe(true)
        expect(box.inputWidth, detail).toBeGreaterThan(box.textWidth)
      }
    } finally {
      await browser.close()
    }
  })
})

interface PwPage {
  setViewportSize: (size: { width: number, height: number }) => Promise<void>
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T, A>(fn: (arg: A) => T, arg: A) => Promise<T>
}
