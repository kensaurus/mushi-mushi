/**
 * @vitest-environment jsdom
 *
 * Owner's walkthrough, 2026-11-17: an app with no fixes showed "0 attempts /
 * No fixes in the last 30 days" and nothing to do. The card says how a fix
 * starts, opens the worst open bug, and turns Autofix on in place.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const preflight = vi.hoisted(() => ({ checks: [] as Array<{ key: string; ready: boolean }> }))
vi.mock('../../lib/useDispatchPreflight', () => ({
  useDispatchPreflight: () => ({ loading: false, ready: false, error: null, checks: preflight.checks, failing: [], reload: vi.fn(), repoUrl: null }),
}))
const turnOn = vi.hoisted(() => vi.fn())
vi.mock('../../lib/useTurnOnAutofix', () => ({ useTurnOnAutofix: () => ({ turnOn, saving: false }) }))

import { FixesStartCard, WORST_BUG_HREF } from './FixesStartCard'
import { FixesPipelineGuide } from './FixesPipelineGuide'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  turnOn.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(githubConnected: boolean) {
  act(() => root.render(createElement(MemoryRouter, null, createElement(FixesStartCard, { githubConnected, projectId: 'p1' }))))
}

describe('FixesStartCard', () => {
  it('says how a fix starts and opens the worst open bug', () => {
    preflight.checks = [{ key: 'github', ready: true }, { key: 'autofix', ready: true }]
    render(true)
    expect(host.textContent).toContain('How a fix starts')
    const worst = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'Open the worst open bug')!
    expect(worst.getAttribute('href')).toBe(WORST_BUG_HREF)
    expect(WORST_BUG_HREF).toBe('/reports?sort=severity&dir=desc')
    expect(host.querySelector('[data-testid="fixes-turn-on-autofix"]')).toBeNull()
  })

  it('offers to turn Autofix on in place when GitHub is ready and Autofix is off', () => {
    preflight.checks = [{ key: 'github', ready: true }, { key: 'autofix', ready: false }]
    render(true)
    act(() => (host.querySelector('[data-testid="fixes-turn-on-autofix"]') as HTMLButtonElement).click())
    expect(turnOn).toHaveBeenCalled()
  })

  it('without GitHub, offers Connect GitHub instead of Autofix', () => {
    preflight.checks = [{ key: 'github', ready: false }, { key: 'autofix', ready: false }]
    render(false)
    expect(host.querySelector('[data-testid="fixes-turn-on-autofix"]')).toBeNull()
    expect(host.textContent).toContain('Connect GitHub')
  })

  // Round-2 review: a separate "How Autofix works (optional)" panel under the
  // card repeated its "Turn on Autofix" step. It is one disclosure inside now.
  it('carries How Autofix works as one flat disclosure inside the card', () => {
    preflight.checks = [{ key: 'github', ready: true }, { key: 'autofix', ready: false }]
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(FixesStartCard, {
            githubConnected: true,
            projectId: 'p1',
            autofixGuide: createElement(FixesPipelineGuide, { flat: true, topPriority: 'healthy' }),
          }),
        ),
      ),
    )
    const how = host.querySelector('[data-testid="fixes-start"] [data-testid="fixes-autofix-how"]')
    expect(how?.tagName).toBe('DETAILS')
    expect(how?.textContent).toContain('How Autofix works')
    expect(host.textContent).not.toContain('(optional)')
  })
})
