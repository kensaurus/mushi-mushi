/**
 * @vitest-environment jsdom
 *
 * CI cost "Open fix PR" (ADR 0047): the confirm dialog names the workflow
 * file and says it is a draft PR; confirming posts the advice's target and
 * evidence, then the job is read until the worker finishes and the PR link
 * shows; a merged PR shows the measured saving; plain-words errors for a
 * refused POST and for a failed job; an applied fix offers no button; the
 * advice card shows one button per fixable workflow.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiAdviceFixable } from '../../lib/ciAdvice'
import type { CiCostFixJob } from '../../lib/ciCostFix'
import type { CiAdvice } from '../../lib/ciTypes'

const state = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: state.apiFetch, apiFetchMutate: state.apiFetchMutate }))

import { CiCostFixButton } from './CiCostFixButton'

/** CiCostFixButton reads a job in flight again every 3 s. */
const COST_FIX_POLL_MS = 3_000
import { CiAdviceList } from './CiSections'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const P = 'p1'
const FIXABLE: CiAdviceFixable = {
  key: 'k1',
  label: 'ci.yml',
  autofix: { kind: 'skip_drafts', projectId: P, repo: 'acme/app', workflowPath: '.github/workflows/ci.yml' },
  evidence: 'acme/app/.github/workflows/ci.yml runs on pull_request and never checks the draft flag.',
  monthSavingUsd: 3.5,
}

function job(over: Partial<CiCostFixJob> = {}): CiCostFixJob {
  return {
    id: 'j1',
    projectId: P,
    repo: 'acme/app',
    workflowPath: '.github/workflows/ci.yml',
    workflowName: 'CI',
    kind: 'skip_drafts',
    status: 'queued',
    summary: null,
    errorCode: null,
    error: null,
    prUrl: null,
    prNumber: null,
    branch: null,
    monthSavingUsd: 3.5,
    baseline: null,
    measured: null,
    saving: null,
    mergedAt: null,
    closedAt: null,
    createdAt: '2026-10-27T12:00:00Z',
    finishedAt: null,
    ...over,
  }
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.apiFetch.mockReset()
  state.apiFetchMutate.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

async function render(el: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, el))
  })
}

const buttons = () => Array.from(document.body.querySelectorAll('button'))
const button = (text: string) => buttons().find((b) => b.textContent?.trim() === text)

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    el.click()
  })
}

describe('CiCostFixButton', () => {
  it('confirms with the file and "draft", posts the target, polls the job and links the PR', async () => {
    vi.useFakeTimers()
    state.apiFetchMutate.mockResolvedValue({ ok: true, data: { job: job() } })
    state.apiFetch.mockResolvedValue({ ok: true, data: { job: job({ status: 'pr_opened', prUrl: 'https://github.com/acme/app/pull/42', prNumber: 42 }) } })
    await render(createElement(CiCostFixButton, { fixable: FIXABLE }))
    expect(host.textContent).toContain('saves about $3.50/mo (estimated)')

    await click(button('Open fix PR'))
    const dialog = document.body.textContent ?? ''
    expect(dialog).toContain('Open a draft fix PR?')
    expect(dialog).toContain('.github/workflows/ci.yml')
    expect(dialog).toContain('acme/app')
    expect(dialog).toMatch(/draft\s*pull request/)
    expect(dialog).toContain('Draft pull requests stop running this workflow')
    expect(state.apiFetchMutate).not.toHaveBeenCalled()

    await click(button('Open draft PR'))
    const [path, opts] = state.apiFetchMutate.mock.calls[0] as [string, { method: string; body: string }]
    expect(path).toBe('/v1/admin/ci/cost-fixes')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({
      projectId: P,
      repo: 'acme/app',
      workflowPath: '.github/workflows/ci.yml',
      kind: 'skip_drafts',
      evidence: FIXABLE.evidence,
      monthSavingUsd: 3.5,
    })
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Opening a draft pull request…')
    expect(button('Open fix PR')).toBeUndefined()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COST_FIX_POLL_MS)
    })
    expect(state.apiFetch).toHaveBeenCalledWith('/v1/admin/ci/cost-fixes/j1', { cache: 'no-store' })
    const link = host.querySelector('a[href="https://github.com/acme/app/pull/42"]')
    expect(link?.textContent).toContain('PR #42')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Draft pull request open')
    expect(button('Check again')).toBeDefined()
  })

  it('a failed job says why in plain words, and the button comes back', async () => {
    vi.useFakeTimers()
    state.apiFetchMutate.mockResolvedValue({ ok: true, data: { job: job() } })
    state.apiFetch.mockResolvedValue({
      ok: true,
      data: { job: job({ status: 'failed', errorCode: 'GITHUB_WORKFLOWS_WRITE_MISSING', error: 'The GitHub access Mushi uses cannot change workflow files.' }) },
    })
    await render(createElement(CiCostFixButton, { fixable: FIXABLE }))
    await click(button('Open fix PR'))
    await click(button('Open draft PR'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COST_FIX_POLL_MS)
    })
    const status = host.querySelector('[role="status"]')
    expect(status?.textContent).toBe('The GitHub access Mushi uses cannot change workflow files.')
    expect(status?.className).toContain('text-danger')
    expect(button('Open fix PR')).toBeDefined()
  })

  it('a refused POST shows a plain sentence', async () => {
    state.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'REPO_NOT_IN_PROJECT', message: 'acme/app is not connected to this project.' } })
    await render(createElement(CiCostFixButton, { fixable: FIXABLE }))
    await click(button('Open fix PR'))
    await click(button('Open draft PR'))
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('This repository is not connected to the project any more. Connect it on the Projects page.')
  })

  it('shows the PR Mushi already opened when the POST says so', async () => {
    state.apiFetchMutate.mockResolvedValue({
      ok: false,
      error: { code: 'PR_ALREADY_OPEN', message: 'Mushi already opened this fix.' },
      data: { job: job({ status: 'pr_opened', prUrl: 'https://github.com/acme/app/pull/7', prNumber: 7 }) },
    })
    await render(createElement(CiCostFixButton, { fixable: FIXABLE }))
    await click(button('Open fix PR'))
    await click(button('Open draft PR'))
    expect(host.querySelector('a[href="https://github.com/acme/app/pull/7"]')).not.toBeNull()
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('a merged fix shows the measured saving; an applied or refused one explains itself', async () => {
    await render(
      createElement(CiCostFixButton, {
        fixable: FIXABLE,
        initialJob: job({
          status: 'pr_opened',
          prUrl: 'https://github.com/acme/app/pull/42',
          prNumber: 42,
          mergedAt: '2026-10-20T00:00:00Z',
          baseline: { from: 'a', to: 'b', days: 14, complete: true, minutes: 280, usd: 1.68, jobs: 100, perDay: [] },
          measured: { from: 'c', to: 'd', days: 3, complete: false, minutes: 24, usd: 0.144, jobs: 10, perDay: [] },
          saving: { minutesPerDay: 12, usdPerMonth: 2.16, measuredDays: 3 },
        }),
      }),
    )
    expect(host.textContent).toContain('Saved 12 billed minutes a day (about $2.16 a month), measured over 3 days against the 14 days before.')
    expect(button('Open fix PR')).toBeUndefined()
    expect(host.textContent).not.toContain('(estimated)')

    await render(createElement(CiCostFixButton, { key: 'applied', fixable: FIXABLE, initialJob: job({ status: 'no_change', summary: 'Already applied: The workflow already skips draft pull requests.' }) }))
    expect(host.textContent).toContain('Already applied')
    expect(button('Open fix PR')).toBeUndefined()
  })
})

describe('CiAdviceList with fixable advice', () => {
  it('shows one "Open fix PR" per workflow with an autofix, and the stored job for each', async () => {
    const advice = (path: string, withFix: boolean): CiAdvice => ({
      id: `drafts_not_skipped:acme/app:.github/workflows/${path}`,
      severity: 'medium',
      title: 'Draft pull requests run the full CI',
      detail: 'd',
      evidence: `acme/app/.github/workflows/${path} never checks the draft flag.`,
      fix: 'add types',
      repo: 'acme/app',
      ...(withFix ? { autofix: { kind: 'skip_drafts' as const, projectId: P, repo: 'acme/app', workflowPath: `.github/workflows/${path}` }, monthSavingUsd: 1 } : {}),
    })
    state.apiFetch.mockResolvedValue({ ok: true, data: { jobs: [job({ workflowPath: '.github/workflows/e2e.yml', status: 'pr_opened', prUrl: 'https://github.com/acme/app/pull/9', prNumber: 9 })] } })
    await render(createElement(CiAdviceList, { advice: [advice('ci.yml', true), advice('e2e.yml', true), advice('lint.yml', false)] }))
    expect(state.apiFetch).toHaveBeenCalledWith(`/v1/admin/ci/cost-fixes?project_id=${P}`, { cache: 'no-store' })
    expect(host.querySelectorAll('[data-testid="ci-cost-fix"]')).toHaveLength(2)
    expect(buttons().filter((b) => b.textContent?.trim() === 'Open fix PR')).toHaveLength(1)
    expect(host.querySelector('a[href="https://github.com/acme/app/pull/9"]')).not.toBeNull()
  })

  it('reads no jobs when no advice can be fixed by a PR', async () => {
    await render(createElement(CiAdviceList, { advice: [] }))
    expect(state.apiFetch).not.toHaveBeenCalled()
  })
})
