/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/prompt-lab/PromptStageTable.test.tsx
 * PURPOSE: The stage table shows full version ids and the Judge score
 *          header at a 390px viewport by scrolling the row, instead of
 *          ellipsizing them (report 79cf5694).
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PromptVersion } from './types'
import { PromptStageTable } from './PromptStageTable'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function prompt(version: string, extra: Partial<PromptVersion> = {}): PromptVersion {
  return {
    id: version,
    project_id: 'p1',
    stage: 'stage2',
    version,
    prompt_template: '',
    is_active: false,
    is_candidate: true,
    traffic_percentage: 10,
    avg_judge_score: 0.82,
    total_evaluations: 4,
    cost_usd_total: 0,
    avg_cost_usd: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
    ...extra,
  }
}

const noop = () => {}

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
    root.render(createElement(PromptStageTable, {
      stage: 'stage2',
      prompts: [
        prompt('v1-baseline-auto-20261028', { is_active: true, is_candidate: false, traffic_percentage: 100 }),
        prompt('v2-experiment'),
      ],
      busy: null,
      onClone: noop,
      onEdit: noop,
      onDiff: noop,
      onActivate: noop,
      onTraffic: noop,
      onDelete: noop,
    }))
  })
}

function classTokens(className: string | null | undefined): string[] {
  return (className ?? '').split(/\s+/).filter(Boolean)
}

describe('PromptStageTable', () => {
  it('keeps the full version id and scrolls instead of truncating the cell', () => {
    render()
    const rows = [...host.querySelectorAll('tbody tr')]
    const versionCells = rows.map((row) => row.querySelector('td'))
    expect(versionCells.map((td) => td?.textContent)).toEqual([
      'v1-baseline-auto-20261028',
      'v2-experiment',
    ])
    for (const td of versionCells) {
      const tokens = classTokens(td?.className)
      expect(tokens).not.toContain('truncate')
      expect(tokens).not.toContain('max-w-40')
      expect(tokens).toContain('whitespace-nowrap')
    }
    const table = host.querySelector('table')
    const scroller = table?.parentElement
    expect(classTokens(scroller?.className)).toEqual(expect.arrayContaining(['min-w-0', 'overflow-x-auto']))
    expect(classTokens(table?.className)).toContain('min-w-max')
    const judge = [...host.querySelectorAll('th')].find((th) => th.textContent?.includes('Judge score'))
    expect(judge?.textContent).toContain('Judge score')
    expect(classTokens(judge?.className)).toContain('whitespace-nowrap')
    expect(classTokens(host.firstElementChild?.className)).toContain('min-w-0')
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

  it.skipIf(!chromiumBin)('scrolls the full version id and Judge score header inside a 390px card', async () => {
    render()
    const card = host.firstElementChild as HTMLElement
    const classNames = new Set<string>(['flex', 'w-full', 'min-w-0', 'flex-col'])
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

    const { chromium } = nodeRequire('playwright') as {
      chromium: { launch: () => Promise<{ newPage: (opts: { viewport: { width: number, height: number } }) => Promise<{ setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>, evaluate: <T>(fn: () => T) => Promise<T>, close: () => Promise<void> }>, close: () => Promise<void> }> }
    }
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style></head><body style="margin:0"><div id="viewport" style="width:390px;overflow:hidden"><div class="flex w-full min-w-0 flex-col">${card.outerHTML}</div></div></body></html>`,
        { waitUntil: 'load' },
      )
      const measured = await page.evaluate(() => {
        const scroller = document.querySelector('.overflow-x-auto') as HTMLElement
        const table = scroller.querySelector('table') as HTMLElement
        const version = table.querySelector('tbody td') as HTMLElement
        const judge = [...table.querySelectorAll('th')].find((th) => th.textContent?.includes('Judge score')) as HTMLElement
        const textWidth = (el: HTMLElement) => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return range.getBoundingClientRect().width
        }
        const versionStyle = getComputedStyle(version)
        const judgeStyle = getComputedStyle(judge)
        return {
          clientWidth: scroller.clientWidth,
          scrollWidth: scroller.scrollWidth,
          versionText: version.textContent,
          versionOverflow: versionStyle.textOverflow,
          versionWhiteSpace: versionStyle.whiteSpace,
          versionTextWidth: textWidth(version),
          versionCellWidth: version.getBoundingClientRect().width,
          judgeText: judge.textContent,
          judgeWhiteSpace: judgeStyle.whiteSpace,
          judgeTextWidth: textWidth(judge),
          judgeCellWidth: judge.getBoundingClientRect().width,
          tableRight: table.getBoundingClientRect().right,
          versionRight: version.getBoundingClientRect().right,
          judgeRight: judge.getBoundingClientRect().right,
        }
      })
      expect(measured.clientWidth).toBeLessThanOrEqual(390)
      expect(measured.scrollWidth).toBeGreaterThan(measured.clientWidth)
      expect(measured.versionText).toBe('v1-baseline-auto-20261028')
      expect(measured.versionOverflow).not.toBe('ellipsis')
      expect(measured.versionWhiteSpace).toBe('nowrap')
      expect(measured.versionCellWidth).toBeGreaterThanOrEqual(measured.versionTextWidth - 1)
      expect(measured.versionRight).toBeLessThanOrEqual(measured.tableRight + 1)
      expect(measured.judgeText).toContain('Judge score')
      expect(measured.judgeWhiteSpace).toBe('nowrap')
      expect(measured.judgeCellWidth).toBeGreaterThanOrEqual(measured.judgeTextWidth - 1)
      expect(measured.judgeRight).toBeLessThanOrEqual(measured.tableRight + 1)
    } finally {
      await browser.close()
    }
  })
})
