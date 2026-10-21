/**
 * @vitest-environment jsdom
 *
 * FixCiFeedback under ADR 0033: a test machine that stopped, a queue that
 * expired, and a job still waiting read as warnings ("your fix was not
 * tested") with Re-run and a link to /ci; a plain cancel is neutral; a code
 * failure stays danger. Re-run reports 409 / 403 in plain words.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiInfraVerdict } from '../../lib/ciTypes'
import { ciOverviewFixture } from '../ci/__fixtures__/ciOverview'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch, apiFetchMutate: mocks.apiFetchMutate }))

import { FixCiFeedback } from './FixCiFeedback'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PR = 'https://github.com/kensaurus/glot.it/pull/143'

const verdict = (over: Partial<CiInfraVerdict>): CiInfraVerdict => ({
  kind: 'runner_lost',
  infra: true,
  job: 'build',
  runner: 'nuc-glot',
  queuedSeconds: null,
  detail: null,
  runId: 1,
  at: '2026-10-21T11:20:00Z',
  ...over,
})

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.apiFetch.mockReset()
  mocks.apiFetchMutate.mockReset()
  mocks.apiFetch.mockResolvedValue({ ok: true, data: ciOverviewFixture() })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(props: Record<string, unknown>) {
  await act(async () => {
    root.render(
      createElement(MemoryRouter, null, createElement(FixCiFeedback, { fixId: 'fix-1', prUrl: PR, prNumber: 143, ...props })),
    )
  })
}

const box = () => host.querySelector('[data-testid="fix-ci-feedback"]') as HTMLElement
const chip = () => box().querySelector('span') as HTMLElement
const button = (text: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.startsWith(text)) as HTMLButtonElement | undefined
const link = (text: string) => Array.from(host.querySelectorAll('a')).find((a) => a.textContent === text) as HTMLAnchorElement | undefined

describe('FixCiFeedback', () => {
  it('runner lost: a warning that the fix was not tested, with Re-run and the CI link', async () => {
    await render({ ciConclusion: 'cancelled', ciInfra: verdict({}) })
    expect(box().dataset.ciState).toBe('runner_lost')
    expect(host.textContent).toContain("Tests didn't finish: the test machine (nuc-glot) stopped. Your fix was not tested.")
    expect(chip().className).toContain('warn')
    expect(chip().className).not.toContain('danger')
    expect(button('Re-run tests')!.disabled).toBe(false)
    expect(link('See CI runners')!.getAttribute('href')).toBe('/ci')
  })

  it('queue expired: says no machine picked it up', async () => {
    await render({ ciConclusion: 'cancelled', ciInfra: verdict({ kind: 'queue_expired', runner: null }) })
    expect(host.textContent).toContain('No test machine picked this up, so GitHub cancelled it.')
    expect(chip().className).toContain('warn')
  })

  it('waiting: shows the wait, its place in the queue, and links to that job', async () => {
    await render({ ciStatus: 'queued', ciInfra: verdict({ kind: 'waiting_for_runner', runner: null, queuedSeconds: 300 }), projectId: 'p1' })
    expect(host.textContent).toContain('Waiting for a test machine for 5 min.')
    expect(mocks.apiFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/admin/ci/overview?project_id=p1'))
    expect(host.textContent).toContain('Position 2 of 2 in the queue for machines labelled nuc')
    expect(link('See CI runners')!.getAttribute('href')).toBe('/ci?job=j3')
    expect(button('Re-run tests')!.disabled).toBe(true)
  })

  it('a plain cancel stays neutral', async () => {
    await render({ ciConclusion: 'cancelled' })
    expect(host.textContent).toContain('Cancelled (a newer push or a person stopped it).')
    expect(chip().className).not.toContain('danger')
    expect(chip().className).not.toContain('warn')
    expect(link('See CI runners')).toBeUndefined()
  })

  it('a code failure stays danger', async () => {
    await render({ ciConclusion: 'failure' })
    expect(chip().textContent).toContain('CI failed')
    expect(chip().className).toContain('danger')
    expect(button('Re-run tests')).toBeUndefined()
  })

  it('Re-run posts to the rerun route and says the tests started', async () => {
    mocks.apiFetchMutate.mockResolvedValue({ ok: true, data: { ok: true, runId: 99 } })
    await render({ ciConclusion: 'cancelled', ciInfra: verdict({}) })
    await act(async () => button('Re-run tests')!.click())
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith('/v1/admin/fixes/fix-1/ci/rerun', expect.objectContaining({ method: 'POST' }))
    expect(host.textContent).toContain('Tests started again.')
    expect(box().dataset.ciState).toBe('running')
  })

  it('Re-run while CI still runs (409) says to wait', async () => {
    mocks.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'CI_RUNNING', message: 'conflict' } })
    await render({ ciConclusion: 'cancelled', ciInfra: verdict({}) })
    await act(async () => button('Re-run tests')!.click())
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Tests are still running on GitHub. Wait for them to finish, then re-run.')
  })

  it('Re-run without Actions: write (403) says which permission is missing', async () => {
    mocks.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'GITHUB_ACTIONS_WRITE_MISSING', message: 'forbidden' } })
    await render({ ciConclusion: 'cancelled', ciInfra: verdict({}) })
    await act(async () => button('Re-run tests')!.click())
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/Actions: write/)
  })
})
