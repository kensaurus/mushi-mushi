/**
 * @vitest-environment jsdom
 */

/**
 * PageStatus (pattern P1, console journeys 2026-10-27): one sentence, at
 * most three numbers that link to what they count, and never a wall of
 * zeros.
 */

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PageStatus, isEmptyMetricValue, type PageStatusMetrics } from './page-status'

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

async function render(el: ReactElement, path = '/fixes') {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, el))
  })
}

describe('isEmptyMetricValue', () => {
  it('treats zero-ish values as empty', () => {
    for (const v of [0, '0', '0%', '0.0 %', '—', '-', '', 'n/a', '$0', null, undefined, Number.NaN]) {
      expect(isEmptyMetricValue(v as number | string | null)).toBe(true)
    }
  })
  it('keeps real values', () => {
    for (const v of [1, '3', '12%', '$4.20', '0.5', 'Live']) expect(isEmptyMetricValue(v)).toBe(false)
  })
})

describe('PageStatus', () => {
  it('renders the sentence and up to three linked numbers', async () => {
    const metrics: PageStatusMetrics = [
      { label: 'Stopped', value: 39, to: '/fixes?tab=attempts&status=failed', tone: 'danger' },
      { label: 'PRs open', value: 7, to: '/repo' },
      { label: 'Fixed', value: 8 },
    ]
    await render(createElement(PageStatus, { sentence: 'Auto-fix stopped on 39 reports.', tone: 'danger', metrics }))
    expect(container.textContent).toContain('Auto-fix stopped on 39 reports.')
    const links = Array.from(container.querySelectorAll('a'))
    expect(links).toHaveLength(2)
    // A link to a tab of the page you are on says "Show", not "Go to <this page>".
    expect(links[0].getAttribute('aria-label')).toBe('39 Stopped — Show All fixes: Stopped')
    // A link elsewhere names the page in today's words.
    expect(links[1].getAttribute('aria-label')).toBe('7 PRs open — Go to Pull requests')
    expect(container.querySelectorAll('dd')).toHaveLength(3)
  })

  it('drops the numbers when every one is empty', async () => {
    await render(
      createElement(PageStatus, {
        sentence: 'Nothing queued.',
        metrics: [
          { label: 'Running', value: 0 },
          { label: 'Rate', value: '—' },
        ],
      }),
    )
    expect(container.textContent).toContain('Nothing queued.')
    expect(container.querySelector('dl')).toBeNull()
  })

  it('shows the first-step card instead when every number is empty and one is given', async () => {
    await render(
      createElement(PageStatus, {
        sentence: 'No experiments.',
        metrics: [{ label: 'Total', value: 0 }],
        empty: { title: 'No experiments yet', sentence: 'Create one to compare two versions.', action: { label: 'Create experiment', to: '/experiments?new=1' } },
      }),
    )
    expect(container.querySelector('[data-testid="page-status"]')).toBeNull()
    expect(container.querySelector('[data-testid="page-first-step"]')).not.toBeNull()
    expect(container.textContent).toContain('Create experiment')
  })

  it('keeps a mix of zero and non-zero numbers', async () => {
    await render(
      createElement(PageStatus, {
        sentence: 'One run failed.',
        metrics: [
          { label: 'Failed', value: 1 },
          { label: 'Running', value: 0 },
        ],
      }),
    )
    expect(container.querySelectorAll('dd')).toHaveLength(2)
  })
})

describe('PageStatus metric visual (2026-11-19)', () => {
  it('draws an optional picture between the value and its label', async () => {
    const metrics: PageStatusMetrics = [
      { label: 'Agreed', value: '42%', visual: createElement('span', { 'data-testid': 'metric-visual' }, 'bar') },
      { label: 'Ready', value: 3 },
    ]
    await render(createElement(PageStatus, { sentence: 'Grades.', metrics }))
    const visual = container.querySelector('[data-testid="metric-visual"]')!
    expect(visual).not.toBeNull()
    // In the same metric as its value and label, in a dd of its own.
    const item = visual.closest('dd')!.parentElement!
    expect(item.textContent).toContain('42%')
    expect(item.textContent).toContain('Agreed')
    // A metric without one renders as before: one dd (the value) and the label.
    const plain = [...container.querySelectorAll('dt')].find((dt) => dt.textContent?.includes('Ready'))!.parentElement!
    expect(plain.querySelectorAll('dd')).toHaveLength(1)
  })

  it('still drops all-empty numbers even when they carry a visual', async () => {
    const metrics: PageStatusMetrics = [{ label: 'Agreed', value: 0, visual: createElement('span', { 'data-testid': 'metric-visual' }) }]
    await render(createElement(PageStatus, { sentence: 'Nothing yet.', metrics }))
    expect(container.querySelector('[data-testid="metric-visual"]')).toBeNull()
  })
})

// A fourth metric is a type error, not a style choice.
// @ts-expect-error — at most three metrics
const _tooMany: PageStatusMetrics = [
  { label: 'a', value: 1 },
  { label: 'b', value: 1 },
  { label: 'c', value: 1 },
  { label: 'd', value: 1 },
]
void _tooMany
