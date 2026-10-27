/**
 * @vitest-environment jsdom
 *
 * /pipeline Workers tab (ADR 0048): machines, lanes and queues from
 * GET /v1/admin/work/lanes; pausing a lane sends only `paused`; moving a
 * queue item sends the whole new order; the empty state shows the install
 * command; "Send to my local worker" appends to the only lane; the pipeline's
 * Requeue posts local worker run ids as claimIds.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkLanesData } from '../../lib/workers'

const state = vi.hoisted(() => ({
  data: null as unknown,
  paths: [] as Array<string | null>,
  calls: [] as Array<{ path: string; method: string; body: unknown }>,
}))

vi.mock('../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: async (path: string, opts: { method?: string; body?: string } = {}) => {
    state.calls.push({ path, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    return { ok: true, data: { results: [], reportIds: [] } }
  },
}))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { data: path ? state.data : null, loading: false, error: null, isValidating: false, reload: () => {}, lastFetchedAt: null }
  },
}))

import { WorkersPanel } from './WorkersPanel'
import { SendToWorkerButton } from './SendToWorkerButton'
import { runPipelineAction } from '../../lib/pipeline'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-10-27T12:00:00Z')

function fixture(): WorkLanesData {
  return {
    generatedAt: '2026-10-27T12:00:00Z',
    projects: [{ id: 'p1', name: 'glot.it' }],
    hosts: [
      {
        id: 'h1',
        hostname: 'alienware',
        platform: 'wsl2',
        version: '0.31.0',
        online: true,
        lastHeartbeatAt: '2026-10-27T11:59:00Z',
        status: { state: 'working', agents: 2, memAvailableGb: 12, ghRemaining: 4200, cursor: 'signed_in' },
        guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 },
        revoked: false,
        mine: true,
      },
    ],
    lanes: [
      {
        id: 'l1',
        hostId: 'h1',
        projectId: 'p1',
        projectName: 'glot.it',
        name: 'glot',
        config: { paused: false, concurrency: 1, model: 'claude-opus-5-5-medium', mode: 'fix', stop_at: null, drain: false, prune_own: false },
        status: { state: 'working', runs: 4 },
        lastSeenAt: '2026-10-27T11:59:00Z',
        active: [{ claimId: 'c9', reportId: 'r9', title: 'Login button does nothing', since: '2026-10-27T11:40:00Z', leaseUntil: '2026-10-27T12:40:00Z', fromQueue: true }],
        queue: [
          { reportId: 'r1', title: 'First queued', severity: 'high', status: 'classified', source: 'console', position: 0 },
          { reportId: 'r2', title: 'Second queued', severity: null, status: 'classified', source: 'console', position: 1 },
        ],
        recent: [
          { claimId: 'c1', reportId: 'r5', title: 'Shop card', outcome: 'pr_opened', failureKind: null, prUrl: 'https://github.com/o/r/pull/7', detail: 'pull request opened', claimedAt: '2026-10-27T09:00:00Z', finishedAt: '2026-10-27T09:30:00Z', autoRequeued: false },
          { claimId: 'c2', reportId: 'r6', title: 'Clone failed', outcome: 'failed', failureKind: 'infra', prUrl: null, detail: 'permission denied', claimedAt: '2026-10-27T10:00:00Z', finishedAt: '2026-10-27T10:01:00Z', autoRequeued: true },
        ],
        counts7d: { runs: 4, prs: 1, noChange: 1, timeouts: 1, errors: 1, infra: 1 },
      },
    ],
  }
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.data = fixture()
  state.paths = []
  state.calls = []
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(el: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, el))
  })
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
async function click(el: Element | null) {
  if (!el) throw new Error('missing element')
  await act(async () => {
    ;(el as HTMLElement).click()
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe('WorkersPanel', () => {
  it('reads this app and shows the machine, its lane, what it runs, its queue and its runs', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect(state.paths[0]).toBe('/v1/admin/work/lanes?projectId=p1')
    expect(q('workers-status')!.textContent).toContain('1 worker online; 1 lane taking reports.')
    expect(q('worker-host-h1')!.textContent).toContain('alienware')
    expect(q('worker-host-h1')!.textContent).toContain('online')
    expect(q('worker-host-h1-heartbeat')!.textContent).toContain('1 min ago')
    const lane = q('worker-lane-l1')!
    expect(lane.textContent).toContain('Login button does nothing')
    expect(q('worker-lane-l1-queue')!.textContent).toContain('First queued')
    expect(q('worker-lane-l1-recent')!.textContent).toContain('Opened a PR')
    expect(q('worker-lane-l1-recent')!.textContent).toContain('Failed · machine')
  })

  it('pausing a lane sends only paused', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const switches = q('worker-lane-l1')!.querySelectorAll('button[role="switch"]')
    await click(switches[0]!)
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1', method: 'PATCH', body: { paused: true } }])
  })

  it('moving a queued report down sends the whole new order', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    await click(q('worker-lane-l1-queue-r1-down'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1/queue', method: 'PUT', body: { reportIds: ['r2', 'r1'] } }])
  })

  it('removing a queued report sends the rest', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    await click(q('worker-lane-l1-queue-r2-remove'))
    expect(state.calls[0]).toEqual({ path: '/v1/admin/work/lanes/l1/queue', method: 'PUT', body: { reportIds: ['r1'] } })
  })

  it('pasted report ids (a lane-v4 queue file) are added at the end of the queue', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const input = q('worker-lane-l1-add') as HTMLInputElement
    const ids = ['2000000a-0000-4000-8000-000000000000', '2000000b-0000-4000-8000-000000000000']
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      set.call(input, `${ids[0]}
${ids[1]} ${ids[0]}`)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(q('worker-lane-l1-add-save')!.textContent).toContain('Add 2')
    await click(q('worker-lane-l1-add-save'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1/queue', method: 'PUT', body: { reportIds: ids, append: true } }])
  })

  it('with no worker, shows how to install one and the lanes.conf import', async () => {
    state.data = { ...fixture(), hosts: [], lanes: [] }
    await render(createElement(WorkersPanel, { projectId: null, now: NOW }))
    expect(state.paths[0]).toBe('/v1/admin/work/lanes')
    expect(q('workers-first-step')!.textContent).toContain('No local worker yet')
    expect(q('workers-empty')!.textContent).toContain('mushi worker install --lane my-app')
    expect(q('workers-empty')!.textContent).toContain('--lanes-conf')
  })
})

describe('SendToWorkerButton', () => {
  it('appends the report to your only lane for the app', async () => {
    await render(createElement(SendToWorkerButton, { projectId: 'p1', reportIds: ['r7'] }))
    expect(state.paths[0]).toBe('/v1/admin/work/lanes?projectId=p1')
    await click(q('send-to-worker'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1/queue', method: 'PUT', body: { reportIds: ['r7'], append: true } }])
  })

  it('is hidden when you have no lane for the app', async () => {
    const data = fixture()
    data.hosts[0]!.mine = false
    state.data = data
    await render(createElement(SendToWorkerButton, { projectId: 'p1', reportIds: ['r7'] }))
    expect(q('send-to-worker')).toBeNull()
  })
})

describe('Requeue', () => {
  it('posts local worker run ids as claimIds', async () => {
    await runPipelineAction('requeue', ['c2'])
    expect(state.calls).toEqual([{ path: '/v1/admin/pipeline/actions', method: 'POST', body: { action: 'requeue', claimIds: ['c2'] } }])
  })
})
