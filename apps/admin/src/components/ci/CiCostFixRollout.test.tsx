/**
 * @vitest-environment jsdom
 *
 * "Apply to every app" (ADR 0047 amendment): the preview groups fixes per
 * repo with their saving and checkboxes, a repo Mushi knows will fail starts
 * unticked with its reason, an open PR cannot be picked; one confirm posts
 * one entry per repo with the picked items; then each repo shows its draft PR,
 * or why there is none, with each refused fix in plain words.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiCostFixJob } from '../../lib/ciCostFix'
import { defaultSelection, selectionRequest, type CiRolloutPreview } from '../../lib/ciCostFixRollout'

const state = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: state.apiFetch, apiFetchMutate: state.apiFetchMutate }))

import { CiCostFixRollout } from './CiCostFixRollout'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const A = 'p-a'
const B = 'p-b'
const BUNDLE = 'b-1'

function item(projectId: string, repo: string, workflowPath: string, kind: string, monthSavingUsd: number | null, state = 'ready', prUrl: string | null = null) {
  return { key: `${projectId}:${repo}:${workflowPath}:${kind}`, projectId, repo, workflowPath, kind, adviceId: kind, title: kind, evidence: 'e', monthSavingUsd, state, prUrl }
}

const PREVIEW = {
  generatedAt: '2026-10-27T12:00:00Z',
  repos: [
    {
      projectId: A,
      projectName: 'Api',
      repo: 'acme/api',
      items: [
        item(A, 'acme/api', '.github/workflows/nightly.yml', 'weekly_cron', 2.5),
        item(A, 'acme/api', '.github/workflows/ci.yml', 'skip_drafts', null),
        item(A, 'acme/api', '.github/workflows/ci.yml', 'add_concurrency', null, 'pr_open', 'https://github.com/acme/api/pull/3'),
      ],
      readyItems: 2,
      monthSavingUsd: 2.5,
      unpricedItems: 1,
      block: null,
    },
    {
      projectId: B,
      projectName: 'Web',
      repo: 'acme/web',
      items: [item(B, 'acme/web', '.github/workflows/ci.yml', 'skip_drafts', 1)],
      readyItems: 1,
      monthSavingUsd: 1,
      unpricedItems: 0,
      block: { code: 'GITHUB_WORKFLOWS_WRITE_MISSING', message: 'The GitHub access Mushi uses cannot change workflow files in this repo.', source: 'setup_check' },
    },
  ],
  totals: { repos: 2, readyItems: 3, monthSavingUsd: 3.5, unpricedItems: 1 },
  caps: { reposPerRequest: 10, itemsPerRepo: 20 },
  partial: null,
} as unknown as CiRolloutPreview

function job(over: Partial<CiCostFixJob>): CiCostFixJob {
  return {
    id: 'j',
    projectId: A,
    repo: 'acme/api',
    workflowPath: '.github/workflows/ci.yml',
    workflowName: 'CI',
    kind: 'skip_drafts',
    status: 'pr_opened',
    summary: null,
    errorCode: null,
    error: null,
    prUrl: null,
    prNumber: null,
    branch: null,
    monthSavingUsd: null,
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
  state.apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith('/v1/admin/ci/cost-fix-rollout')) return { ok: true, data: PREVIEW }
    if (path === `/v1/admin/ci/cost-fix-bundles/${BUNDLE}`) {
      return {
        ok: true,
        data: {
          bundle: {
            id: BUNDLE,
            projectId: A,
            repo: 'acme/api',
            status: 'pr_opened',
            prUrl: 'https://github.com/acme/api/pull/9',
            prNumber: 9,
            createdAt: '2026-10-27T12:00:00Z',
            measuredUsdPerMonth: null,
            items: [
              job({ id: 'j1', kind: 'skip_drafts', summary: 'The workflow now skips draft pull requests.' }),
              job({ id: 'j2', kind: 'weekly_cron', workflowPath: '.github/workflows/nightly.yml', status: 'refused', error: 'This scheduled workflow looks like it deploys or releases.' }),
            ],
          },
        },
      }
    }
    return { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CiCostFixRollout)))
  })
}

async function click(el: Element | null | undefined) {
  if (!el) throw new Error('element not found')
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

const byText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('CiCostFixRollout', () => {
  it('previews every app per repo with the saving; a repo Mushi knows will fail starts unticked with its reason', async () => {
    await render()
    await click(document.querySelector('[data-testid="ci-rollout-open"]'))
    await flush()
    expect(state.apiFetch).toHaveBeenCalledWith('/v1/admin/ci/cost-fix-rollout', expect.objectContaining({ scope: 'enumeration' }))
    const groups = document.querySelectorAll('[data-testid="ci-rollout-repo"]')
    expect(groups).toHaveLength(2)
    expect(groups[0].textContent).toContain('acme/api')
    expect(groups[0].textContent).toContain('2 ready: about $2.50 a month (estimated), 1 not priced')
    expect(groups[0].textContent).toContain('already open')
    expect(groups[1].textContent).toContain('cannot change workflow files')
    const boxes = (g: Element) => [...g.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(boxes(groups[0]).map((b) => [b.checked, b.disabled])).toEqual([[true, false], [true, false], [true, false], [false, true]])
    expect(boxes(groups[1]).every((b) => !b.checked)).toBe(true)
    expect(document.body.textContent).toContain('1 repo, 2 fixes: about $2.50 a month (estimated), 1 not priced.')
  })

  it('one confirm opens one draft PR per repo, then shows the PR and each refusal in plain words', async () => {
    state.apiFetchMutate.mockResolvedValue({
      ok: true,
      data: { queued: 1, results: [{ projectId: A, repo: 'acme/api', status: 'queued', bundleId: BUNDLE, jobs: [], skipped: [], error: null }] },
    })
    await render()
    await click(document.querySelector('[data-testid="ci-rollout-open"]'))
    await flush()
    await click(document.querySelector('[data-testid="ci-rollout-continue"]'))
    expect(document.body.textContent).toContain('Open 1 draft pull request?')
    await click(byText('Open draft PRs'))
    expect(state.apiFetchMutate).toHaveBeenCalledTimes(1)
    const [path, opts] = state.apiFetchMutate.mock.calls[0]
    expect(path).toBe('/v1/admin/ci/cost-fix-rollout')
    expect(JSON.parse(opts.body)).toEqual({
      repos: [{ projectId: A, repo: 'acme/api', items: [{ workflowPath: '.github/workflows/nightly.yml', kind: 'weekly_cron' }, { workflowPath: '.github/workflows/ci.yml', kind: 'skip_drafts' }] }],
    })
    await flush()
    await flush()
    const result = document.querySelector('[data-testid="ci-rollout-result"]')
    expect(result?.textContent).toContain('PR #9')
    expect(result?.textContent).toContain('Draft pull request open. Review it, mark it ready and merge it. 1 fix was left out')
    expect(result?.textContent).toContain('Not changed: This scheduled workflow looks like it deploys or releases.')
    expect(result?.textContent).toContain('The workflow now skips draft pull requests.')
  })

  it('Esc on the confirm closes only the confirm; the preview and its selection stay', async () => {
    await render()
    await click(document.querySelector('[data-testid="ci-rollout-open"]'))
    await flush()
    await click(document.querySelector('[data-testid="ci-rollout-continue"]'))
    expect(document.body.textContent).toContain('Open 1 draft pull request?')
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(document.querySelector('[data-testid="ci-rollout"]')).not.toBeNull()
    expect(document.body.textContent).toContain('1 repo, 2 fixes')
  })

  it('shows a repo that did not start, and an error from the request, in plain words', async () => {
    state.apiFetchMutate.mockResolvedValueOnce({ ok: false, error: { code: 'FORBIDDEN', message: 'x' } })
    await render()
    await click(document.querySelector('[data-testid="ci-rollout-open"]'))
    await flush()
    await click(document.querySelector('[data-testid="ci-rollout-continue"]'))
    await click(byText('Open draft PRs'))
    expect(document.body.textContent).toContain('Viewers cannot open pull requests.')

    state.apiFetchMutate.mockResolvedValueOnce({
      ok: true,
      data: { queued: 0, results: [{ projectId: A, repo: 'acme/api', status: 'error', bundleId: null, jobs: [], skipped: [], error: { code: 'RATE_LIMITED', message: 'Mushi opens at most 10 CI fix pull requests an hour per project. Try this repo again later.' } }] },
    })
    await click(document.querySelector('[data-testid="ci-rollout-continue"]'))
    await click(byText('Open draft PRs'))
    expect(document.querySelector('[data-testid="ci-rollout-result"]')?.textContent).toContain('Try this repo again later.')
  })
})

describe('selection', () => {
  it('ticks ready items of unblocked repos only, and the request groups them per repo', () => {
    const sel = defaultSelection(PREVIEW)
    expect([...sel].sort()).toEqual([`${A}:acme/api:.github/workflows/ci.yml:skip_drafts`, `${A}:acme/api:.github/workflows/nightly.yml:weekly_cron`].sort())
    const req = selectionRequest(PREVIEW, new Set([...sel, `${B}:acme/web:.github/workflows/ci.yml:skip_drafts`, `${A}:acme/api:.github/workflows/ci.yml:add_concurrency`]))
    expect(req.repos.map((r) => [r.repo, r.items.length])).toEqual([['acme/api', 2], ['acme/web', 1]])
    expect(req).toMatchObject({ items: 3, monthSavingUsd: 3.5, unpriced: 1, overRepoCap: false, overItemCap: false })
  })

  it('flags a selection over the caps', () => {
    const many = { ...PREVIEW, caps: { reposPerRequest: 1, itemsPerRepo: 1 } } as CiRolloutPreview
    const all = new Set(many.repos.flatMap((r) => r.items.map((i) => i.key)))
    expect(selectionRequest(many, all)).toMatchObject({ overRepoCap: true, overItemCap: true })
    expect(defaultSelection(many).size).toBe(1)
  })
})
