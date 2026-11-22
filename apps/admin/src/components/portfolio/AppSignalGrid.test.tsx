/**
 * @vitest-environment jsdom
 *
 * Apps by signal, round 2 (2026-11-18): a column unknown on (nearly) every app is not drawn,
 * one line says so and keeps the few values there are ("Release age: no release data for 8 of
 * 9 apps · mushi-mushi 182d"); on a narrow screen each app is a stacked block of labelled
 * cells, so no column hides off the right edge.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HeatColumn, HeatRow } from '../signal/HeatGrid'
import type { PortfolioCard } from '../../lib/portfolioTypes'
import { rankApps } from '../../lib/appSignals'
import { AppSignalGrid, sparseColumns } from './AppSignalGrid'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-11-18T12:00:00Z')

const card = (name: string, over: Partial<PortfolioCard> = {}): PortfolioCard => ({
  projectId: name,
  name,
  slug: null,
  kind: 'app',
  kindSource: 'declared',
  worst: 'drift',
  elements: {},
  error: null,
  needsLook: [],
  openReports: 3,
  sdk: [{ projectId: name, package: '@mushi-mushi/web', version: '1.33.0', latest: '1.33.0', status: 'current', reason: 'Latest.' }],
  latestRelease: null,
  radar: { checkedAt: new Date(NOW - 3600_000).toISOString(), status: 'pass', open: { error: 0, warn: 1, info: 0 }, unchecked: 0, errored: 0 },
  spend: { llmUsd30d: 0, llmCalls30d: 0, partial: false, autofixCapUsd: null, monthlyLlmBudgetUsd: null, capsKnown: true },
  unreadable: [],
  ciFailsToday: 1,
  ...over,
}) as PortfolioCard

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('sparseColumns', () => {
  const col = (id: string): HeatColumn => ({ id, label: id, scale: 'bad' })
  const row = (id: string, v: number | null): HeatRow => ({ id, label: id, cells: { x: { value: v, display: v == null ? 'none' : `${v}d` } } })

  it('drops a column with a value on at most a fifth of the apps, and keeps those values', () => {
    const rows = [row('a', 182), ...['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id) => row(id, null))]
    expect(sparseColumns([col('x')], rows)).toEqual([{ id: 'x', label: 'x', unknown: 8, total: 9, known: [{ name: 'a', shown: '182d' }] }])
  })

  it('keeps a column most apps have, and never drops on fewer than three apps', () => {
    expect(sparseColumns([col('x')], [row('a', 1), row('b', 2), row('c', null)])).toEqual([])
    expect(sparseColumns([col('x')], [row('a', null), row('b', null)])).toEqual([])
  })
})

describe('AppSignalGrid', () => {
  it('leaves out the Release age column when (nearly) no app has shipped, and says so once', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const cards = names.map((n) => card(n, n === 'a' ? { latestRelease: { version: '1.0.0', publishedAt: new Date(NOW - 182 * 86_400_000).toISOString() } as PortfolioCard['latestRelease'] } : {}))
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(AppSignalGrid, { rows: rankApps(cards, new Map(), NOW), now: NOW }))))
    const wide = host.querySelector('[data-testid="portfolio-signal-grid"]')!
    expect(wide.querySelector('thead')!.textContent).not.toContain('Release age')
    expect(wide.querySelector('[data-col="release"]')).toBeNull()
    const note = host.querySelector('[data-testid="portfolio-signal-sparse-release"]')!
    expect(note.textContent).toContain('Release age: no release data for 8 of 9 apps')
    expect(note.textContent).toContain('a 182d')
    // Still drawn: a column every app has.
    expect(wide.querySelector('thead')!.textContent).toContain('CI fails today')
  })

  it('stacks each app as labelled cells for a narrow screen, every signal kept', async () => {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(AppSignalGrid, { rows: rankApps([card('a'), card('b')], new Map(), NOW), now: NOW }))))
    const stack = host.querySelector('[data-testid="portfolio-signal-stack"]')!
    expect(stack.parentElement!.className).toContain('@2xl:hidden')
    expect(host.querySelector('[data-testid="portfolio-signal-grid"]')!.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['hidden', '@2xl:block']))
    const a = stack.querySelector('[data-testid="signal-stack-a"]')!
    expect([...a.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Open bugs', 'Risks', 'SDK', 'Release age', 'CI fails today', 'Last check-in'])
    expect(a.querySelector('[data-col="ci"]')!.textContent).toBe('1')
  })
})
