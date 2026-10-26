/**
 * @vitest-environment jsdom
 *
 * /pipeline: the stages with counts, stuck counts and the oldest age; every
 * stuck group by default, one stage's groups after a click; a group opens to
 * its items with their evidence; a bulk action asks first, posts the PR ids,
 * shows each PR's result and reads again; Close needs a reason; train retry
 * shows why no train left; intake rejects read "not recorded yet"; All apps
 * drops the project id.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipelineData } from '../lib/pipeline'

const state = vi.hoisted(() => ({
  data: null as unknown,
  projectId: 'p1' as string | null,
  paths: [] as Array<{ path: string | null; scope?: string }>,
  posts: [] as Array<{ path: string; body: unknown }>,
  reloads: 0,
  respond: (_path: string, _body: unknown): unknown => ({ ok: true, data: { results: [] } }),
}))

vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: async (path: string, opts: { body?: string } = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null
    state.posts.push({ path, body })
    return state.respond(path, body)
  },
}))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null, opts: { scope?: string } = {}) => {
    state.paths.push({ path, scope: opts.scope })
    return {
      data: state.data,
      loading: false,
      error: null,
      isValidating: false,
      reload: () => {
        state.reloads++
      },
      lastFetchedAt: null,
    }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => state.projectId }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/PageHeaderBar', async () => {
  const { createElement: h } = await import('react')
  return {
    PageHeaderBar: ({ title, description, children }: { title: string; description?: string; children?: unknown }) =>
      h('header', null, h('h1', null, title), h('p', null, description), children as never),
  }
})

import { PipelinePage } from './PipelinePage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  projectId: 'p1',
  reportId: `r-${id}`,
  title: `Report ${id}`,
  repo: 'kensaurus/glot.it',
  prNumber: Number(id.replace(/\D/g, '')) || 1,
  prUrl: `https://github.com/kensaurus/glot.it/pull/${id.replace(/\D/g, '') || 1}`,
  queueId: null,
  since: '2026-10-24T12:00:00Z',
  lastError: null,
  lastEventAt: null,
  lastEventLabel: null,
  failingChecks: [],
  review: null,
  queueDetail: null,
  ...over,
})

function fixture(): PipelineData {
  const stage = (id: string, label: string, groups: PipelineData['stages'][number]['groups']) => ({
    id: id as never,
    label,
    count: groups.reduce((n, g) => n + g.count, 0),
    stuck: groups.filter((g) => g.tone === 'stuck').reduce((n, g) => n + g.count, 0),
    oldestAt: groups[0]?.oldestAt ?? null,
    groups,
  })
  return {
    generatedAt: '2026-10-26T11:59:00Z',
    projects: [{ id: 'p1', name: 'glot.it', lastDeploy: null }],
    stages: [
      stage('reported', 'Reported', []),
      stage('triaged', 'Triaged', []),
      stage('pr', 'Fix PR', [
        {
          id: 'autofix_no_agent',
          stage: 'pr',
          tone: 'stuck',
          label: '1 app: auto-fix is on but has no agent key; 0 dispatches in 48h',
          count: 1,
          oldestAt: '2026-10-24T01:00:00Z',
          actions: [],
          settings: { label: 'Cursor keys and spend-down', to: '/credits#cursor-fix-bugs' },
          items: [item('p1', { title: 'glot.it', reportId: null, prUrl: null, prNumber: null, lastError: 'Auto-fix is on but has no agent key; 0 dispatches in 48h' })],
        },
        { id: 'draft_no_ci', stage: 'pr', tone: 'stuck', label: '1 draft: CI never ran', count: 1, oldestAt: '2026-10-25T12:00:00Z', actions: ['mark_ready', 'close'], settings: null, items: [item('f9')] },
      ]),
      stage('review', 'Reviewed', [
        {
          id: 'hold',
          stage: 'review',
          tone: 'stuck',
          label: '1 PR: Opus says hold; a person decides',
          count: 1,
          oldestAt: '2026-10-24T12:00:00Z',
          actions: ['re_review', 'close'],
          settings: null,
          items: [item('f5', { review: { verdict: 'hold', summary: 'Fixes one case of three.', findings: ['major: The Shop card is not fixed.'] } })],
        },
      ]),
      stage('ci', 'CI', [
        {
          id: 'ci_red_queued',
          stage: 'ci',
          tone: 'stuck',
          label: '2 PRs: their own CI is red, yet they wait for a release train',
          count: 2,
          oldestAt: '2026-10-23T12:00:00Z',
          actions: ['ci_repair', 'rerun_ci'],
          settings: { label: 'Review follow-ups setting', to: '/settings?tab=byok#review-followups' },
          items: [item('f1', { failingChecks: ['Build & Test'], lastEventAt: '2026-10-26T09:00:00Z', lastEventLabel: 'CI finished: failed' }), item('f2')],
        },
      ]),
      stage('train', 'Release train', [
        { id: 'next_train', stage: 'train', tone: 'moving', label: '3 PRs: approved, waiting for the next release train', count: 3, oldestAt: '2026-10-26T06:00:00Z', actions: [], settings: null, items: [] },
      ]),
      stage('merged', 'Merged', []),
      stage('deployed', 'Deployed', []),
    ],
    dispatchers: [
      {
        projectId: 'p1',
        name: 'glot.it',
        autofixOn: true,
        opener: 'both',
        server: { agentKeys: 0, offKeys: 1, dispatches24h: 0, dispatches48h: 0, lastAt: '2026-10-24T01:00:00Z' },
        local: { runs24h: 6, running: 2, lastAt: '2026-10-26T11:00:00Z' },
        problem: 'Auto-fix is on but has no agent key (1 Cursor key off or spend-down off); 0 dispatches in 48h',
      },
      {
        projectId: 'p2',
        name: 'quiet-app',
        autofixOn: false,
        opener: 'nobody',
        server: { agentKeys: 0, offKeys: 0, dispatches24h: 0, dispatches48h: 0, lastAt: null },
        local: { runs24h: 0, running: 0, lastAt: null },
        problem: null,
      },
    ],
    trains: [
      {
        repo: 'kensaurus/glot.it',
        projectId: 'p1',
        merged: 1,
        failed: 2,
        active: 0,
        topFailures: [{ check: 'Build & Test', count: 2 }],
        trains: [
          { id: 't2', state: 'failed', prNumber: 902, members: 3, attempt: 1, detail: 'CI failed: Build & Test.', createdAt: '2026-10-26T10:00:00Z' },
          { id: 't1', state: 'merged', prNumber: 901, members: 2, attempt: 1, detail: 'Merged 2 fixes.', createdAt: '2026-10-25T10:00:00Z' },
        ],
      },
    ],
    intake: null,
    ciReadable: true,
  }
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.data = fixture()
  state.projectId = 'p1'
  state.paths = []
  state.posts = []
  state.reloads = 0
  state.respond = () => ({ ok: true, data: { results: [] } })
  window.localStorage.clear()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

async function render(url = '/pipeline') {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(PipelinePage)))
  })
}

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
async function click(el: Element | null) {
  if (!el) throw new Error('missing element')
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe('PipelinePage', () => {
  it('reads this app and shows each stage with its count, stuck count and oldest age', async () => {
    await render()
    expect(state.paths[0]).toEqual({ path: '/v1/admin/pipeline?projectId=p1', scope: 'project' })
    expect(q('pipeline-stage-ci-count')!.textContent).toBe('2')
    expect(q('pipeline-stage-ci-stuck')!.textContent).toContain('2 stuck')
    expect(q('pipeline-stage-ci')!.textContent).toContain('oldest 3 d')
    expect(q('pipeline-stage-train-stuck')).toBeNull()
    expect(q('pipeline-stage-train')!.textContent).toContain('flowing')
  })

  it('lists every stuck group by default, biggest first, and one stage after a click', async () => {
    await render()
    const ids = Array.from(document.querySelectorAll('[data-testid^="pipeline-group-"][data-testid$="-toggle"]')).map((e) => e.getAttribute('data-testid'))
    expect(ids).toEqual(['pipeline-group-ci_red_queued-toggle', 'pipeline-group-autofix_no_agent-toggle', 'pipeline-group-draft_no_ci-toggle', 'pipeline-group-hold-toggle'])
    expect(q('pipeline-group-next_train')).toBeNull()
    await click(q('pipeline-stage-train'))
    expect(q('pipeline-group-next_train')).not.toBeNull()
    expect(q('pipeline-group-ci_red_queued')).toBeNull()
  })

  it('opens a group to its items with the evidence and links the blocking setting', async () => {
    await render()
    expect(q('pipeline-group-ci_red_queued-settings')!.getAttribute('href')).toBe('/settings?tab=byok#review-followups')
    await click(q('pipeline-group-ci_red_queued-toggle'))
    const f1 = q('pipeline-item-f1')!
    expect(f1.textContent).toContain('Report f1')
    expect(f1.textContent).toContain('Build & Test')
    expect(f1.querySelector('a[href="https://github.com/kensaurus/glot.it/pull/1"]')).not.toBeNull()
    expect(q('pipeline-item-f1-last-event')!.textContent).toBe('· last: CI finished: failed (3 h ago)')
    await click(q('pipeline-group-hold-toggle'))
    expect(q('pipeline-item-f5')!.textContent).toContain('Opus: hold')
    expect(q('pipeline-item-f5')!.textContent).toContain('The Shop card is not fixed.')
  })

  it('a bulk action asks first, posts every PR, shows each result and reads again', async () => {
    state.respond = (path) =>
      path === '/v1/admin/pipeline/actions'
        ? {
            ok: true,
            data: {
              results: [
                { id: 'f1', ok: true, message: 'Queued a CI-repair agent; it starts within 10 minutes.' },
                { id: 'f2', ok: false, message: 'Not queued. Review follow-ups are turned off for this organization.' },
              ],
            },
          }
        : { ok: true }
    await render()
    await click(q('pipeline-group-ci_red_queued-ci_repair'))
    expect(state.posts).toEqual([])
    expect(document.body.textContent).toContain('Queues one Cursor agent per PR')
    const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Send to CI repair' && b.hasAttribute('data-primary'))!
    await click(confirm)
    await flush()
    expect(state.posts).toEqual([{ path: '/v1/admin/pipeline/actions', body: { action: 'ci_repair', fixIds: ['f1', 'f2'] } }])
    expect(state.reloads).toBe(1)
    await click(q('pipeline-group-ci_red_queued-toggle'))
    expect(q('pipeline-item-f1-result')!.textContent).toBe('Queued a CI-repair agent; it starts within 10 minutes.')
    expect(q('pipeline-item-f2-result')!.textContent).toContain('turned off')
  })

  it('Close needs a reason before it can run, and sends it', async () => {
    state.respond = () => ({ ok: true, data: { results: [{ id: 'f9', ok: true, message: 'Closed; the reason is a note on the report.' }] } })
    await render()
    await click(q('pipeline-group-draft_no_ci-close'))
    const confirm = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Close PR' && b.hasAttribute('data-primary'))!
    expect(confirm().disabled).toBe(true)
    const box = q('pipeline-action-reason') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(box, 'Fixed by hand in #44')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(confirm().disabled).toBe(false)
    await click(confirm())
    await flush()
    expect(state.posts[0]).toEqual({ path: '/v1/admin/pipeline/actions', body: { action: 'close', fixIds: ['f9'], reason: 'Fixed by hand in #44' } })
  })

  it('re-review goes to the existing review route, one PR at a time', async () => {
    state.respond = () => ({ ok: true, data: {} })
    await render()
    await click(q('pipeline-group-hold-re_review'))
    const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Re-run review' && b.hasAttribute('data-primary'))!
    await click(confirm)
    await flush()
    expect(state.posts.map((p) => p.path)).toEqual(['/v1/admin/fixes/f5/review'])
  })

  it('shows the train strip, the checks that fail it most, and why no train left on retry', async () => {
    state.respond = () => ({ ok: true, data: { results: [{ id: 'kensaurus/glot.it', ok: false, message: 'No train left: the next one may leave at 16:00 UTC (one train every 360 min).' }] } })
    await render()
    const row = q('pipeline-train-kensaurus/glot.it')!
    expect(row.textContent).toContain('1 merged')
    expect(row.textContent).toContain('2 failed')
    expect(row.textContent).toContain('Build & Test ×2')
    const squares = row.querySelectorAll('[role="listitem"]')
    expect(squares).toHaveLength(2)
    await click(squares[1])
    expect(q('pipeline-train-detail')!.textContent).toContain('CI failed: Build & Test.')
    await click(q('pipeline-train-kensaurus/glot.it-retry'))
    const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Run now')!
    await click(confirm)
    await flush()
    expect(state.posts[0]).toEqual({ path: '/v1/admin/pipeline/actions', body: { action: 'train_retry', projectId: 'p1' } })
    expect(q('pipeline-train-kensaurus/glot.it-result')!.textContent).toContain('next one may leave at 16:00 UTC')
  })

  it('shows who opens fixes per app, red where auto-fix is on but nothing can dispatch', async () => {
    await render()
    expect(q('pipeline-stage-pr-openers')!.textContent).toBe('24h: server 0 · local 1 · nobody 1 apps')
    const glot = q('pipeline-opener-p1')!
    expect(glot.textContent).toContain('Server + local')
    expect(glot.textContent).toContain('On · 0 agent keys (1 off) · 0 in 24h · last 2 d ago')
    expect(glot.textContent).toContain('6 in 24h · 2 running · last 1 h ago')
    expect(q('pipeline-opener-p1-problem')!.querySelector('a')!.getAttribute('href')).toBe('/credits#cursor-fix-bugs')
    expect(q('pipeline-opener-p2')!.textContent).toContain('Nobody')
    expect(q('pipeline-opener-p2-problem')).toBeNull()
    expect(q('pipeline-group-autofix_no_agent-settings')!.getAttribute('href')).toBe('/credits#cursor-fix-bugs')
  })

  it('says intake rejects are not counted yet, never 0', async () => {
    await render()
    expect(q('pipeline-intake-not-recorded')!.textContent).toContain('not counted here yet')
    expect(q('pipeline-intake')!.textContent).toContain('no deploy recorded in 14 days')
  })

  it('All apps reads every app without a project id', async () => {
    await render('/pipeline?apps=all')
    expect(state.paths[0]).toEqual({ path: '/v1/admin/pipeline', scope: 'enumeration' })
  })
})
