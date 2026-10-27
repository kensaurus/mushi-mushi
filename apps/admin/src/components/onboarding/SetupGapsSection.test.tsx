/**
 * @vitest-environment jsdom
 *
 * "Setup gaps" on the Set up page (console ops plan 2026-10-27, P1): reads
 * the active app's checks, leads with one sentence, lists gaps and checks it
 * could not read with a Fix link each, folds passing checks into one line,
 * never says "all fine" while a check is unknown, and renders loading and
 * error states. "Check again" asks the server to re-check.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupGap, SetupGapsResponse } from '../../lib/setupGaps'

const state = vi.hoisted(() => ({ data: null as unknown, error: null as string | null, loading: false, paths: [] as Array<string | null>, reload: vi.fn() }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { data: state.data, loading: state.loading, error: state.error, isValidating: false, reload: state.reload, lastFetchedAt: null }
  },
}))

import { SetupGapsSection } from './SetupGapsSection'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const P = '1000000a-0000-4000-8000-000000000000'
const gap = (id: string, status: SetupGap['status'], fixHref = '/connect#connect-github'): SetupGap => ({
  id,
  projectId: P,
  audience: 'app_owner',
  status,
  title: `Title ${id}`,
  summary: `Summary ${id}`,
  fixHref,
})
const response = (gaps: SetupGap[]): SetupGapsResponse => ({
  generatedAt: '2026-10-27T12:00:00Z',
  projects: [{ projectId: P, name: 'glot.it', checkedAt: '2026-10-27T12:00:00Z', gaps }],
  counts: { ok: 0, gap: 0, unknown: 0 },
  truncated: false,
})

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.data = response([gap('github_access:kensaurus/glot.it', 'gap'), gap('slack_bot_token', 'unknown', '/integrations/config'), gap('deploy_events', 'ok')])
  state.error = null
  state.loading = false
  state.paths = []
  state.reload.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(projectId: string | null = P) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(SetupGapsSection, { projectId })))
  })
}
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

describe('SetupGapsSection', () => {
  it("reads the active app's checks and sits at #setup-gaps", async () => {
    await render()
    expect(state.paths[0]).toBe(`/v1/admin/setup-gaps?projectId=${P}`)
    expect(host.querySelector('#setup-gaps')).not.toBeNull()
  })

  it('leads with the count to fix and lists gaps and unread checks with a link each', async () => {
    await render()
    expect(q('setup-gaps-status')!.textContent).toContain('1 thing to fix before it breaks a fix or a reply. Mushi could not check 1 thing more.')
    const open = q('setup-gaps-open')!
    expect(open.querySelectorAll('li')).toHaveLength(2)
    const fix = q('setup-gap-github_access:kensaurus/glot.it')!.querySelector('a')!
    expect(fix.textContent).toBe('Fix')
    expect(fix.getAttribute('href')).toBe('/connect#connect-github')
    expect(q('setup-gap-slack_bot_token')!.querySelector('a')!.textContent).toBe('Open')
    expect(q('setup-gaps-fine')!.textContent).toContain('1 check pass')
    expect(q('setup-gap-deploy_events')!.querySelector('a')).toBeNull()
  })

  it('never says all fine while a check could not be read', async () => {
    state.data = response([gap('slack_bot_token', 'unknown'), gap('deploy_events', 'ok')])
    await render()
    expect(q('setup-gaps-status')!.textContent).toContain('Nothing missing found, but Mushi could not check 1 thing.')
    state.data = response([gap('slack_bot_token', 'ok'), gap('deploy_events', 'ok')])
    await render()
    expect(q('setup-gaps-status')!.textContent).toContain('All 2 checks pass.')
    expect(q('setup-gaps-open')).toBeNull()
  })

  it('"Check again" asks the server to re-check', async () => {
    await render()
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Check again')!
    await act(async () => btn.click())
    expect(state.paths.at(-1)).toBe(`/v1/admin/setup-gaps?projectId=${P}&refresh=1`)
  })

  it('shows loading and error states, and nothing without an app', async () => {
    state.data = null
    state.loading = true
    await render()
    expect(host.textContent).toContain('Checking your setup…')
    state.loading = false
    state.error = 'Network error'
    await render()
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Network error')
    await render(null)
    expect(q('setup-gaps')).toBeNull()
  })
})
