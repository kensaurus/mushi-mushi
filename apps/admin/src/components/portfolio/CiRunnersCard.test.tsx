/**
 * @vitest-environment jsdom
 *
 * Portfolio CI runners card: machines online, wait p95, machine failures and
 * the top advice across every readable app (no project_id), linking to /ci.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ciOverviewFixture, emptyCiOverview } from '../ci/__fixtures__/ciOverview'

const state = vi.hoisted(() => ({ overview: null as unknown, calls: [] as Array<{ path: string | null; scope?: string }> }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null, opts: { scope?: string } = {}) => {
    state.calls.push({ path, scope: opts.scope })
    return { data: state.overview, loading: false, error: null, isValidating: false, reload: () => {} }
  },
}))

import { CiRunnersCard } from './CiRunnersCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.calls = []
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(CiRunnersCard))))
}

describe('CiRunnersCard', () => {
  it('summarises CI across every app and links to /ci', async () => {
    state.overview = ciOverviewFixture()
    await render()
    expect(state.calls[0]).toEqual({ path: '/v1/admin/ci/overview?days=7', scope: 'enumeration' })
    expect(host.textContent).toContain('1 of 2')
    expect(host.textContent).toContain('25 min')
    expect(host.textContent).toContain('Speed it up: nuc-glot ran out of memory')
    expect(Array.from(host.querySelectorAll('a')).some((a) => a.getAttribute('href') === '/ci')).toBe(true)
  })

  it('says so when no CI jobs were seen', async () => {
    state.overview = emptyCiOverview()
    await render()
    expect(host.textContent).toContain('No CI jobs seen yet across your apps.')
    expect(host.textContent).not.toContain('Machines online')
  })
})
