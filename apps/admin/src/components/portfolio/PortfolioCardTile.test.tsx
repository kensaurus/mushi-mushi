/**
 * @vitest-environment jsdom
 *
 * A Portfolio card names its own top problem: a chip that differs between
 * apps and one next step to the page that fixes it. Mushi's setup chore (no
 * spend cap) is never the next step while the app has open bugs.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The icon is not under test, and its resolver needs a built @mushi-mushi/core.
vi.mock('../ProjectFavicon', () => ({ ProjectFavicon: () => null }))

import type { PortfolioCard } from '../../lib/portfolioTypes'
import { PortfolioCardTile, PortfolioCompactRow } from './PortfolioCardTile'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const card = (over: Partial<PortfolioCard>): PortfolioCard => ({
  projectId: 'p1',
  name: 'yen-yen',
  slug: 'yen-yen',
  kind: 'app',
  kindSource: 'declared',
  worst: 'drift',
  elements: {},
  error: null,
  needsLook: [
    {
      element: 'gates',
      label: 'Automated checks',
      state: 'drift',
      reason: '1 problem to fix: Mushi setup check (1). They and their fixes are under Risk checks on the Recipe page.',
    },
  ],
  openReports: 29,
  sdk: [],
  latestRelease: null,
  radar: { checkedAt: '2026-10-26T00:00:00Z', status: 'pass', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 0 },
  spend: { llmUsd30d: 0, llmCalls30d: 0, partial: false, autofixCapUsd: null, monthlyLlmBudgetUsd: null, capsKnown: true },
  unreadable: [],
  ...over,
})

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

function render(node: ReturnType<typeof createElement>) {
  act(() => root.render(createElement(MemoryRouter, null, node)))
}

const favicon = { project_id: 'p1', project_name: 'yen-yen', project_slug: 'yen-yen' }

describe('PortfolioCardTile', () => {
  it('leads with the open bugs, not the Mushi setup chore', () => {
    render(createElement(PortfolioCardTile, { card: card({}), favicon, showSpend: false }))
    expect(host.textContent).toContain('Bugs to fix')
    expect(host.textContent).not.toContain('Needs attention')
    const next = host.querySelector('[data-testid="portfolio-next-step"]') as HTMLAnchorElement
    expect(next.textContent).toContain('Fix the worst of 29 open bugs')
    expect(next.getAttribute('href')).toBe('/reports')
  })

  it('names a failing part in the chip and links to its page', () => {
    render(
      createElement(PortfolioCardTile, {
        card: card({ openReports: 0, needsLook: [{ element: 'ci', label: 'CI', state: 'error', reason: 'Mushi could not read your CI builds.' }] }),
        favicon,
        showSpend: false,
      }),
    )
    expect(host.textContent).toContain('CI failing')
    expect((host.querySelector('[data-testid="portfolio-next-step"]') as HTMLAnchorElement).getAttribute('href')).toBe('/ci')
  })
})

describe('PortfolioCompactRow', () => {
  it('shows the chore an app without urgent problems still has', () => {
    render(createElement('ul', null, createElement(PortfolioCompactRow, { card: card({ openReports: 0 }), favicon })))
    expect(host.textContent).toContain('Mushi setup')
  })
})
