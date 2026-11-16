/**
 * FILE: apps/admin/src/components/graph/GraphCanvas.test.tsx
 * PURPOSE: The pan/zoom hint must not cover the graph, and at 390px it
 *          stays one scrolling line that never breaks before a middot
 *          (report 8171741f).
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@xyflow/react', async () => {
  const { createElement: h } = await import('react')
  return {
    ReactFlow: ({
      children,
      className,
      ...props
    }: {
      children?: ReactNode
      className?: string
      'aria-label'?: string
    }) =>
      h(
        'div',
        {
          className: ['react-flow', className].filter(Boolean).join(' '),
          style: { width: '100%', height: '100%' },
          'aria-label': props['aria-label'],
        },
        children,
      ),
    Background: () => null,
    Panel: ({ children }: { children?: ReactNode }) => h('div', null, children),
    useReactFlow: () => ({
      zoomIn: () => {},
      zoomOut: () => {},
      fitView: () => {},
    }),
    Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  }
})

import { GraphCanvas } from './GraphCanvas'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HINT_KEY = 'mushi.graph.hintSeen'
const SENTENCE = 'Drag to pan · scroll to zoom · click a node for blast radius'

function props() {
  return {
    flowNodes: [],
    flowEdges: [],
    filteredCount: 3,
    filteredEdgeCount: 2,
    onNodeClick: () => {},
    onPaneClick: () => {},
    onResetView: () => {},
  }
}

let host: HTMLDivElement
let root: Root
let mounted = false

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.removeItem(HINT_KEY)
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = false
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  mounted = false
  host.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  window.localStorage.removeItem(HINT_KEY)
})

function render() {
  act(() => {
    root.render(createElement(GraphCanvas, props()))
  })
  mounted = true
}

describe('GraphCanvas pan/zoom hint', () => {
  it('sits above the graph as one line whose phrases do not open with a middot', () => {
    render()
    const hint = host.querySelector('[data-testid="graph-pan-zoom-hint"]')
    const flow = host.querySelector('.react-flow')
    expect(hint).not.toBeNull()
    expect(flow).not.toBeNull()
    expect(flow!.contains(hint)).toBe(false)
    expect(hint!.compareDocumentPosition(flow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const scroll = host.querySelector('[data-testid="graph-pan-zoom-hint-scroll"]')
    const line = host.querySelector('[data-testid="graph-pan-zoom-hint-line"]')
    expect(scroll?.className).toContain('overflow-x-auto')
    expect(scroll?.className).toContain('overflow-y-hidden')
    expect(scroll?.className).toContain('min-w-0')
    expect(line?.className).toContain('whitespace-nowrap')
    expect(line?.className).toContain('flex-nowrap')
    expect(line?.className).toContain('w-max')

    const parts = [...host.querySelectorAll('[data-hint-part]')]
    expect(parts.map((part) => part.textContent).join('')).toBe(SENTENCE)
    for (const part of parts) {
      const trimmed = part.textContent?.trim() ?? ''
      expect(trimmed.startsWith('·')).toBe(false)
      expect(part.className).toContain('whitespace-nowrap')
      expect(part.className).toContain('shrink-0')
      if (trimmed.includes('·')) expect(trimmed.endsWith('·')).toBe(true)
    }

    const frame = host.firstElementChild as HTMLElement
    // The CSSOM drops a nested calc() inside clamp(); the frame height is unchanged.
    expect(frame.style.height).toContain('clamp(380px')
    expect(frame.style.height).toContain('100dvh - 540px')
    expect(frame.style.height).toContain('600px')
    expect(frame.className).toContain('flex-col')
    expect(flow!.parentElement?.className).toContain('flex-1')
    expect(flow!.parentElement?.className).toContain('min-h-0')
  })

  it('dismisses without putting the hint back on the graph', () => {
    render()
    const button = host.querySelector('[aria-label="Dismiss hint"]') as HTMLButtonElement
    act(() => button.click())
    expect(host.querySelector('[data-testid="graph-pan-zoom-hint"]')).toBeNull()
    expect(host.querySelector('.react-flow')).not.toBeNull()
    expect(window.localStorage.getItem(HINT_KEY)).toBe('1')
  })

  it('hides the hint on the first paint once it has been seen', () => {
    window.localStorage.setItem(HINT_KEY, '1')
    render()
    expect(host.querySelector('[data-testid="graph-pan-zoom-hint"]')).toBeNull()
    expect(host.querySelector('.react-flow')).not.toBeNull()
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

  it.skipIf(!chromiumBin)(
    'scrolls one line inside a 390px frame without covering the graph',
    async () => {
      render()
      const frame = host.firstElementChild as HTMLElement
      const html = frame.outerHTML
      const classNames = new Set<string>()
      for (const el of [frame, ...Array.from(frame.querySelectorAll('*'))]) {
        for (const token of (el.getAttribute('class') ?? '').split(/\s+/)) {
          if (token) classNames.add(token)
        }
      }
      act(() => root.unmount())
      mounted = false
      vi.clearAllTimers()
      vi.useRealTimers()

      const nodeRequire = createRequire(import.meta.url)
      const fromVite = createRequire(nodeRequire.resolve('@tailwindcss/vite'))
      const { compile } = (await import(fromVite.resolve('@tailwindcss/node'))) as {
        compile: (
          css: string,
          options: { base: string; onDependency: () => void },
        ) => Promise<{
          build: (candidates: string[]) => string
        }>
      }
      const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
      const compiler = await compile('@import "tailwindcss";\n', {
        base: adminRoot,
        onDependency() {},
      })
      const utilityCss = compiler.build([...classNames])

      const { chromium } = nodeRequire('playwright') as {
        chromium: {
          launch: () => Promise<{
            newPage: (opts: { viewport: { width: number; height: number } }) => Promise<{
              setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
              evaluate: <T>(fn: () => T) => Promise<T>
              close: () => Promise<void>
            }>
            close: () => Promise<void>
          }>
        }
      }
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style></head><body style="margin:0"><div id="viewport" style="width:390px;overflow:hidden">${html}</div></body></html>`,
          { waitUntil: 'load' },
        )
        const measured = await page.evaluate(() => {
          const frame = document.querySelector('[role="region"]') as HTMLElement
          const hint = document.querySelector('[data-testid="graph-pan-zoom-hint"]') as HTMLElement
          const scroll = document.querySelector(
            '[data-testid="graph-pan-zoom-hint-scroll"]',
          ) as HTMLElement
          const line = document.querySelector(
            '[data-testid="graph-pan-zoom-hint-line"]',
          ) as HTMLElement
          const flow = document.querySelector('.react-flow') as HTMLElement
          const frameBox = frame.getBoundingClientRect()
          const hintBox = hint.getBoundingClientRect()
          const flowBox = flow.getBoundingClientRect()
          const parts = [...document.querySelectorAll('[data-hint-part]')].map((el) => {
            const text = el.textContent ?? ''
            const dot = text.indexOf('·')
            let dotOnSameLine = true
            if (dot >= 0 && el.firstChild) {
              const before = document.createRange()
              before.setStart(el.firstChild, 0)
              before.setEnd(el.firstChild, dot)
              const mark = document.createRange()
              mark.setStart(el.firstChild, dot)
              mark.setEnd(el.firstChild, dot + 1)
              const beforeBox = before.getBoundingClientRect()
              const markBox = mark.getBoundingClientRect()
              dotOnSameLine =
                Math.abs(beforeBox.top - markBox.top) < 1 && markBox.left >= beforeBox.left - 1
            }
            return {
              text: text.trim(),
              rects: el.getClientRects().length,
              dotOnSameLine,
            }
          })
          return {
            frameTop: frameBox.top,
            frameHeight: frameBox.height,
            hintTop: hintBox.top,
            hintBottom: hintBox.bottom,
            hintRight: hintBox.right,
            flowTop: flowBox.top,
            flowHeight: flowBox.height,
            flowBottom: flowBox.bottom,
            frameBottom: frameBox.bottom,
            lineRects: line.getClientRects().length,
            lineHeight: line.getBoundingClientRect().height,
            whiteSpace: getComputedStyle(line).whiteSpace,
            overflowX: getComputedStyle(scroll).overflowX,
            clientWidth: scroll.clientWidth,
            scrollWidth: scroll.scrollWidth,
            text: line.textContent,
            parts,
          }
        })

        expect(measured.frameHeight).toBeGreaterThanOrEqual(380)
        expect(measured.frameHeight).toBeLessThan(400)
        expect(measured.hintTop).toBeLessThanOrEqual(measured.frameTop + 2)
        expect(measured.flowTop).toBeGreaterThanOrEqual(measured.hintBottom - 1)
        expect(measured.flowHeight).toBeGreaterThan(200)
        expect(measured.flowBottom).toBeLessThanOrEqual(measured.frameBottom + 1)
        expect(measured.hintRight).toBeLessThanOrEqual(390.5)
        expect(measured.lineRects).toBe(1)
        expect(measured.lineHeight).toBeGreaterThan(0)
        expect(measured.lineHeight).toBeLessThan(28)
        expect(measured.whiteSpace).toBe('nowrap')
        expect(measured.overflowX).toBe('auto')
        expect(measured.clientWidth).toBeLessThanOrEqual(390)
        expect(measured.scrollWidth).toBeGreaterThan(measured.clientWidth)
        expect(measured.text).toBe(SENTENCE)
        for (const part of measured.parts) {
          expect(part.text.startsWith('·')).toBe(false)
          expect(part.rects).toBe(1)
          expect(part.dotOnSameLine).toBe(true)
          if (part.text.includes('·')) expect(part.text.endsWith('·')).toBe(true)
        }
      } finally {
        await browser.close()
      }
    },
  )
})
