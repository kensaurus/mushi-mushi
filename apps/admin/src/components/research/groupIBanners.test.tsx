/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/research/groupIBanners.test.tsx
 * PURPOSE: Status-banner actions that used to go nowhere:
 *          - Research "Attach evidence" opened an empty Search tab; it now
 *            opens the session whose snippets need attaching.
 *          - Intelligence "Check LLM keys" opened Settings → General.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResearchStatusBanner } from './ResearchStatusBanner'
import { EMPTY_RESEARCH_STATS } from './ResearchStatsTypes'
import { IntelligenceStatusBanner } from '../intelligence/IntelligenceStatusBanner'
import { EMPTY_INTELLIGENCE_STATS } from '../intelligence/IntelligenceStatsTypes'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const findByText = (text: string) =>
  [...container.querySelectorAll('a,button')].find((el) => el.textContent?.trim() === text)

describe('ResearchStatusBanner', () => {
  it('"Attach evidence" opens the session with unattached snippets', () => {
    const onAttach = vi.fn()
    const onTab = vi.fn()
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(ResearchStatusBanner, {
            stats: {
              ...EMPTY_RESEARCH_STATS,
              hasAnyProject: true,
              topPriority: 'unattached_snippets',
              unattachedSnippets: 3,
              latestUnattachedSessionId: 's1',
            },
            onTab,
            onAttach,
          }),
        ),
      ),
    )
    act(() => (findByText('Attach evidence') as HTMLButtonElement).click())
    expect(onAttach).toHaveBeenCalledTimes(1)
    expect(onTab).not.toHaveBeenCalledWith('search')
  })
})

describe('IntelligenceStatusBanner', () => {
  it('"Check LLM keys" opens the AI keys tab', () => {
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(IntelligenceStatusBanner, {
            stats: { ...EMPTY_INTELLIGENCE_STATS, hasAnyProject: true, topPriority: 'job_failed' },
          }),
        ),
      ),
    )
    const link = findByText('Check LLM keys') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/settings?tab=byok')
  })
})
