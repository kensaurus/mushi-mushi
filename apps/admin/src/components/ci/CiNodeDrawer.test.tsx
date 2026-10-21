/**
 * @vitest-environment jsdom
 *
 * /ci node drawer: a runner shows its status in words, its machine and
 * repositories as chips that open those nodes, a 7-day outcome chart and a
 * memory gauge; a runner GitHub did not list says so instead of "Not seen";
 * the GitHub-hosted runner card opens a drawer of its own.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiOverview } from '../../lib/ciTypes'
import { CiNodeDrawer } from './CiNodeDrawer'
import { GITHUB_RUNNER_ID } from './ciMapContext'
import { ciOverviewFixture } from './__fixtures__/ciOverview'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

function open(nodeId: string, overview: CiOverview = ciOverviewFixture(), onSelect = vi.fn()) {
  act(() => root.render(createElement(CiNodeDrawer, { overview, nodeId, onClose: () => {}, onSelect })))
  return onSelect
}

const text = () => document.body.textContent ?? ''
const button = (name: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement | undefined

describe('CiNodeDrawer', () => {
  it('shows a runner as status, machine, repos, chart and memory gauge', () => {
    const onSelect = open('runner:nuc-glot')
    expect(text()).toContain('Busy')
    expect(text()).toContain('Last 7 days')
    expect(document.body.querySelector('[role="meter"][aria-label="Memory now"]')).not.toBeNull()
    expect(document.body.querySelector('[aria-label^="Finished jobs per day"]')).not.toBeNull()

    act(() => button('nuc')!.click())
    expect(onSelect).toHaveBeenCalledWith('host:h-nuc')
    act(() => button('kensaurus/glot.it')!.click())
    expect(onSelect).toHaveBeenCalledWith('repo:kensaurus/glot.it')
  })

  it('says why a runner GitHub did not list has no status', () => {
    open('runner:aw-1', ciOverviewFixture({ runners: [], hosts: [], permissions: { jobs: 'ok', runners: 'missing' } }))
    expect(text()).toContain('Status unknown')
    expect(text()).toContain('Administration: read')
    expect(text()).not.toContain('Not seen')
  })

  it('does not call a runner listed by GitHub when its rows only come from jobs', () => {
    const o = ciOverviewFixture()
    open('runner:aw-1', { ...o, runners: o.runners.map((r) => ({ ...r, status: 'unknown' as const })), hosts: [] })
    expect(text()).toContain('No (seen on jobs only)')
  })

  it('opens the GitHub-hosted runner card with the repos that used it', () => {
    const onSelect = open(GITHUB_RUNNER_ID)
    expect(text()).toContain('On demand')
    act(() => button('kensaurus/mushi-mushi')!.click())
    expect(onSelect).toHaveBeenCalledWith('repo:kensaurus/mushi-mushi')
  })

  it("lists a machine's runners as buttons that open them", () => {
    const onSelect = open('host:h-nuc')
    act(() => button('nuc-glot')!.click())
    expect(onSelect).toHaveBeenCalledWith('runner:nuc-glot')
  })
})
