/**
 * @vitest-environment jsdom
 *
 * FixCiFeedback under ADR 0033: a test machine that stopped, a queue that
 * expired, and a job still waiting read as warnings ("your fix was not
 * tested") with Re-run and a link to /ci; a plain cancel is neutral; a code
 * failure stays danger and names the failing checks, with Re-run and Send to
 * CI repair. Re-run reports 409 / 403 in plain words.
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
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
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
    expect(button('Send to CI repair')).toBeUndefined()
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

  it('a code failure names the failing checks and offers re-run and CI repair', async () => {
    mocks.apiFetch.mockImplementation(async (path: string, opts?: { method?: string; body?: string }) => {
      if ((opts?.method ?? 'GET').toUpperCase() === 'POST') {
        return { ok: true, data: { results: [{ id: 'fix-1', ok: true, message: 'Queued a cloud CI-repair agent; it starts within 10 minutes.' }] } }
      }
      if (String(path).includes('/pipeline/fix/')) {
        return { ok: true, data: { item: { failingChecks: ['Lint, typecheck, build, doctor'] } } }
      }
      return { ok: true, data: ciOverviewFixture() }
    })
    await render({ ciConclusion: 'failure' })
    expect(chip().textContent).toContain('CI failed')
    expect(chip().textContent).toContain('Lint, typecheck, build, doctor')
    expect(chip().className).toContain('danger')
    expect(button('Re-run tests')).toBeDefined()
    expect(button('Send to CI repair')).toBeDefined()
    await act(async () => button('Send to CI repair')!.click())
    const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Send to CI repair' && b.hasAttribute('data-primary'))!
    await act(async () => confirm.click())
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
    const repairCall = mocks.apiFetch.mock.calls.find((c) => String(c[0]).includes('/pipeline/actions'))
    expect(repairCall?.[1]).toEqual(expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse((repairCall?.[1] as { body: string }).body)).toEqual({ action: 'ci_repair', fixIds: ['fix-1'] })
    expect(host.textContent).toContain('Queued a cloud CI-repair agent')
  })

  it('Re-run posts to the rerun route and says the tests started', async () => {
    mocks.apiFetchMutate.mockResolvedValue({ ok: true, data: { rerun: [{ runId: 99 }], headSha: 'abc123' } })
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

  it('Re-run past the hourly limit (429) says when to try again', async () => {
    mocks.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'RATE_LIMITED', message: 'Tests can be re-run 6 times an hour per fix.' } })
    await render({ ciConclusion: 'cancelled', ciInfra: verdict({}) })
    await act(async () => button('Re-run tests')!.click())
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/6 times an hour per fix/)
  })

  it('Re-run without Actions: write (403) says which permission is missing', async () => {
    mocks.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'GITHUB_ACTIONS_WRITE_MISSING', message: 'forbidden' } })
    await render({ ciConclusion: 'cancelled', ciInfra: verdict({}) })
    await act(async () => button('Re-run tests')!.click())
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/Actions: write/)
  })
})
