/**
 * @vitest-environment jsdom
 *
 * A portfolio card with found risks must not also say "Not checked yet",
 * and the next-step line stays readable past one truncated line.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PortfolioCard } from '../../lib/portfolioTypes'
import { PortfolioCardTile } from './PortfolioCardTile'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function card(): PortfolioCard {
  return {
    projectId: '450e6ba8-cf2b-4841-bb38-08141e1ebe77',
    name: 'glot.it',
    slug: 'glot',
    kind: 'site',
    kindSource: 'declared',
    worst: 'unknown',
    elements: {},
    error: null,
    needsLook: [{
      element: 'env',
      state: 'unknown',
      label: 'Environment variables',
      reason: 'Missing from GitHub: A_LONG_SECRET_NAME_THAT_GETS_CUT_OFF_ON_ONE_LINE',
    }],
    openReports: 0,
    sdk: [],
    latestRelease: null,
    radar: { checkedAt: null, status: 'fail', open: { error: 5, warn: 0, info: 0 }, unchecked: 0, errored: 0 },
    spend: { llmUsd30d: 0, llmCalls30d: 0, partial: false, autofixCapUsd: null, monthlyLlmBudgetUsd: null, capsKnown: true },
    unreadable: [],
  }
}

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

describe('PortfolioCardTile', () => {
  it('does not say Not checked yet beside found risks, and the next step can wrap', async () => {
    const c = card()
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(PortfolioCardTile, {
        card: c,
        favicon: { project_id: c.projectId, project_name: c.name, project_slug: 'glot' },
        showSpend: false,
      })))
    })
    expect(host.textContent).toContain('Needs attention')
    expect(host.textContent).toContain('5 risks to fix')
    expect(host.textContent).not.toContain('Not checked yet')
    const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent?.includes('Next step'))
    expect(link?.className).toContain('line-clamp-2')
    expect(link?.getAttribute('title')).toContain('A_LONG_SECRET_NAME_THAT_GETS_CUT_OFF_ON_ONE_LINE')
  })
})
