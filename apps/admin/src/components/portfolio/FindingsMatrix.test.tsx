/**
 * @vitest-environment jsdom
 */

/**
 * Fix once as findings × apps (2026-11-18): rows serious first, then by apps; a dot only in
 * the cells of the apps a problem is open in; an icon per app column with its name; the
 * explanation only after the row is opened; and the Across rows grouped with icons, never
 * a comma list of app names.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FindingGroup, PortfolioFindingsResponse } from '../../lib/portfolioTypes'
import type { PageDataState } from '../../lib/usePageData'
import { fixOnceRows } from '../../lib/groupAppFindings'
import { FindingsMatrix } from './FindingsMatrix'
import { PortfolioFindings } from './PortfolioFindings'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NAMES: Record<string, string> = { a: 'glot.it', b: 'yen-yen', c: 'twm', d: 'calm-app' }
const iconFor = (id: string) => ({ project_id: id, project_name: NAMES[id] ?? id, project_slug: id })

const group = (over: Partial<FindingGroup>): FindingGroup => ({
  ruleId: 'x', title: null, gate: 'radar', gateLabel: 'Mushi setup check', severity: 'warn', projectIds: [], findingCount: 2,
  sampleMessage: 'A sample sentence explaining the finding.', suggestedFix: 'The fix prompt', ...over,
})

const GROUPS = [
  group({ ruleId: 'spend_cap_unset', projectIds: ['a', 'b', 'c'], sampleMessage: 'No monthly budget is set on these apps.' }),
  group({ ruleId: 'byok_key_invalid', severity: 'error', projectIds: ['b', 'd'], sampleMessage: 'Your anthropic key "main" is rejected by anthropic.' }),
  group({ ruleId: 'index_stale', projectIds: ['a', 'b', 'c', 'd'] }),
]

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

async function render(el: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, el))
  })
}

const rowIds = () => [...container.querySelectorAll('[data-testid^="fix-once-row-"]')].map((r) => r.getAttribute('data-testid')!.replace('fix-once-row-', ''))

describe('FindingsMatrix', () => {
  it('sorts serious first, then by apps affected, each with one action', async () => {
    await render(createElement(FindingsMatrix, { rows: fixOnceRows(GROUPS, (g) => g.sampleMessage), appOrder: ['d', 'c', 'b', 'a'], iconFor }))
    expect(rowIds()).toEqual(['byok_key_invalid', 'index_stale', 'spend_cap_unset'])
    const first = container.querySelector('[data-testid="fix-once-row-byok_key_invalid"]')!
    expect(first.getAttribute('data-severity')).toBe('error')
    expect(first.querySelector('[data-testid="status-mark"]')!.getAttribute('data-status')).toBe('failed')
    expect(first.querySelector('[data-testid="status-mark"]')!.getAttribute('aria-label')).toBe('Serious')
    expect([...first.querySelectorAll('button')].map((b) => b.textContent)).toContain('Fix key')
    const budget = container.querySelector('[data-testid="fix-once-row-spend_cap_unset"]')!
    expect(budget.querySelector('[data-testid="status-mark"]')!.getAttribute('aria-label')).toBe('Look at')
    expect([...budget.querySelectorAll('button')].map((b) => b.textContent)).toContain('Set budget')
  })

  it('has an icon column per affected app, in page order, named for screen readers', async () => {
    await render(createElement(FindingsMatrix, { rows: fixOnceRows(GROUPS, (g) => g.sampleMessage), appOrder: ['d', 'c', 'b', 'a'], iconFor }))
    const cols = [...container.querySelectorAll('[data-testid^="fix-once-col-"]')]
    expect(cols.map((c) => c.getAttribute('data-testid'))).toEqual(['fix-once-col-d', 'fix-once-col-c', 'fix-once-col-b', 'fix-once-col-a'])
    expect(cols[0]!.getAttribute('title')).toBe('calm-app')
    expect(cols[0]!.querySelector('.sr-only')!.textContent).toBe('calm-app')
    // The favicon (initials in jsdom) sits in the header, not a printed name list.
    expect(cols[0]!.children.length).toBeGreaterThan(1)
  })

  it('draws a dot only in the cells of the apps a problem is open in', async () => {
    await render(createElement(FindingsMatrix, { rows: fixOnceRows(GROUPS, (g) => g.sampleMessage), appOrder: ['d', 'c', 'b', 'a'], iconFor }))
    const row = container.querySelector('[data-testid="fix-once-row-byok_key_invalid"]')!
    const cells = [...row.querySelectorAll('td[data-app]')]
    expect(cells.map((c) => [c.getAttribute('data-app'), c.querySelector('[data-testid="fix-once-dot"]') != null])).toEqual([
      ['d', true],
      ['c', false],
      ['b', true],
      ['a', false],
    ])
    expect(cells.filter((c) => !c.querySelector('[data-testid="fix-once-dot"]')).every((c) => c.textContent === '')).toBe(true)
    expect(row.querySelector('[data-testid="fix-once-dot"]')!.getAttribute('aria-label')).toBe('AI key rejected: calm-app')
  })

  it('scrolls sideways in its own positioned box, so its sr-only headers never widen the page', async () => {
    await render(createElement(FindingsMatrix, { rows: fixOnceRows(GROUPS, (g) => g.sampleMessage), appOrder: [], iconFor }))
    const box = container.querySelector('[data-testid="fix-once-matrix"]')!
    // An absolutely placed sr-only span escapes an overflow box that is not its containing block.
    expect(box.className.split(' ')).toEqual(expect.arrayContaining(['relative', 'min-w-0', 'overflow-x-auto']))
    expect(box.querySelector('table')).not.toBeNull()
  })

  it('shows the explanation only after the row is opened', async () => {
    await render(createElement(FindingsMatrix, { rows: fixOnceRows(GROUPS, (g) => g.sampleMessage), appOrder: [], iconFor }))
    expect(container.textContent).not.toContain('is rejected by anthropic')
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="fix-once-row-byok_key_invalid"] button[aria-expanded]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-testid="fix-once-detail-byok_key_invalid"]')!.textContent).toContain('Your anthropic key "main" is rejected by anthropic.')
    await act(async () => toggle.click())
    expect(container.querySelector('[data-testid="fix-once-detail-byok_key_invalid"]')).toBeNull()
  })
})

describe('PortfolioFindings', () => {
  const state = (data: PortfolioFindingsResponse): PageDataState<PortfolioFindingsResponse> =>
    ({ data, loading: false, error: null, errorCode: null, errorEndpoint: null, requestId: null, reload: vi.fn(), isValidating: false, lastFetchedAt: null }) as unknown as PageDataState<PortfolioFindingsResponse>

  const probe = (id: string) => ({
    id: `p:${id}`, ruleId: 'recipe_incomplete', severity: 'info' as const, projectIds: [id], resourceKey: null,
    message: `${NAMES[id]} (app) has no version probe.`, suggestedFix: 'Publish a version.json with each build.',
  })

  it('groups the per-app sentence into one row with the apps as icons and one action', async () => {
    await render(createElement(PortfolioFindings, {
      findings: state({ organizationId: 'o', generatedAt: '', groups: GROUPS, sdkSkew: [], holes: [], crossProject: ['a', 'b', 'c'].map(probe), readErrors: [] }),
      iconFor,
      appOrder: ['a', 'b', 'c', 'd'],
    }))
    const rows = [...container.querySelectorAll('[data-testid="across-apps"] > li')]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('No version probe')
    expect(rows[0]!.querySelector('[data-testid="app-icon-chips"]')!.getAttribute('data-count')).toBe('3')
    expect([...rows[0]!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Add probe'])
    // Never "yen-yen (app) has no version probe." per app, and never a comma list of names.
    expect(container.textContent).not.toContain('has no version probe')
    expect(container.textContent).not.toContain('glot.it, yen-yen')
    expect(container.querySelector('[data-testid="fix-once-matrix"]')).not.toBeNull()
  })

  it('draws Fix once as a matrix from 768 px of room and as rows below it, both in the DOM', async () => {
    await render(createElement(PortfolioFindings, {
      findings: state({ organizationId: 'o', generatedAt: '', groups: GROUPS, sdkSkew: [], holes: [], crossProject: [], readErrors: [] }),
      iconFor,
      appOrder: ['d', 'c', 'b', 'a'],
    }))
    const classes = (id: string) => container.querySelector(`[data-testid="${id}"]`)!.className.split(' ')
    // The container query resolves against the wrapper; the wrapper itself carries no @ class.
    expect(classes('fix-once')).toEqual(['@container'])
    expect(classes('fix-once-wide')).toEqual(expect.arrayContaining(['hidden', '@3xl:block']))
    expect(container.querySelector('[data-testid="fix-once-wide"] [data-testid="fix-once-matrix"]')).not.toBeNull()
    expect(classes('fix-once-list')).toContain('@3xl:hidden')
    const items = [...container.querySelectorAll('[data-testid^="fix-once-item-"]')]
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual(['fix-once-item-byok_key_invalid', 'fix-once-item-index_stale', 'fix-once-item-spend_cap_unset'])
    // Each row: severity mark, title, app count, the app icons in page order and one action.
    const first = items[0]!
    expect(first.querySelector('[data-testid="status-mark"]')!.getAttribute('data-status')).toBe('failed')
    expect(first.textContent).toContain('AI key rejected')
    const chips = first.querySelector('[data-testid="app-icon-chips"]')!
    expect(chips.getAttribute('data-count')).toBe('2')
    expect([...chips.querySelectorAll('li[data-app]')].map((li) => li.getAttribute('data-app'))).toEqual(['d', 'b'])
    expect([...first.querySelectorAll('button')].map((b) => b.textContent)).toContain('Fix key')
  })

  it('reads an empty list as a green mark, not a sentence', async () => {
    await render(createElement(PortfolioFindings, {
      findings: state({ organizationId: 'o', generatedAt: '', groups: [], sdkSkew: [], holes: [], crossProject: [], readErrors: [] }),
      iconFor,
      appOrder: [],
    }))
    const pills = [...container.querySelectorAll('[data-testid="status-pill"]')]
    expect(pills.map((p) => [p.getAttribute('data-status'), p.textContent])).toEqual([
      ['passed', 'Nothing open in 2+ apps'],
      ['passed', 'All on the latest SDK'],
      ['passed', 'Nothing missing'],
    ])
  })
})
