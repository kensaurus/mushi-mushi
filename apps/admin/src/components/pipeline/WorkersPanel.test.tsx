/**
 * @vitest-environment jsdom
 *
 * /pipeline Workers tab (ADR 0048): machines, lanes and queues from
 * GET /v1/admin/work/lanes; pausing a lane sends only `paused`; moving or
 * removing a queued report sends that one report (POST …/queue/move), never
 * the whole list; pasted ids go to the top or the end; the empty state shows
 * the install command; "Send to my local worker" puts the report at the top
 * of the only lane (fix next); the pipeline's
 * Requeue posts local worker run ids as claimIds. P3 modes: the mode menu
 * offers all five, an audit lane sets its veto model, and a conflict or audit
 * run shows as text (it holds no report).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workersSummary, type WorkerFlagAction, type WorkLanesData } from '../../lib/workers'

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
import { commonLaneSettings, groupRecentRuns, queueDuplicates, recentGroupText } from './WorkerLaneCard'
import { isWorkersTabLink } from './WorkerFlags'
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
  it('shows the Cursor account the lanes spend, and Switch account for the machine\'s owner only', async () => {
    const data = fixture()
    data.hosts[0] = { ...data.hosts[0]!, cursorAccount: 'kensaurus@gmail.com', cursorLogin: { requestId: 'x', state: 'link_ready', account: 'kensaurus@gmail.com', requestedAt: '2026-10-27T11:58:00Z', at: '2026-10-27T11:59:00Z', detail: null }, canSwitchAccount: true }
    state.data = data
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect(q('worker-host-h1-account')!.textContent).toContain('Lanes spend:kensaurus@gmail.com')
    expect(q('worker-host-h1-account')!.textContent).toContain('sign-in link ready')
    expect(q('worker-host-h1-switch-account')!.textContent).toBe('Open the sign-in')
    act(() => root.unmount())
    root = createRoot(host)
    const other = fixture()
    other.hosts[0] = { ...other.hosts[0]!, mine: false, cursorAccount: 'k***@g***.com' }
    state.data = other
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect(q('worker-host-h1-account')!.textContent).toContain('k***@g***.com')
    expect(q('worker-host-h1-switch-account')).toBeNull()
  })

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
    // States are status pills (2026-11-18): the machine is online, a PR passed,
    // a machine failure is slow rather than the code's fault.
    const pills = (id: string) => [...q(id)!.querySelectorAll('[data-testid="status-pill"]')].map((p) => [p.getAttribute('data-status'), p.textContent])
    expect(pills('worker-host-h1')).toEqual(expect.arrayContaining([['passed', 'online']]))
    expect(pills('worker-lane-l1-recent')).toEqual(expect.arrayContaining([['passed', 'Opened a PR'], ['slow', 'Failed · machine']]))
  })

  it('pausing a lane sends only paused', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const switches = q('worker-lane-l1')!.querySelectorAll('button[role="switch"]')
    await click(switches[0]!)
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1', method: 'PATCH', body: { paused: true } }])
  })

  it('moving a queued report sends only that report and where it goes', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    await click(q('worker-lane-l1-queue-r1-down'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1/queue/move', method: 'POST', body: { reportId: 'r1', to: 'down' } }])
  })

  it('Top moves a report to the top; the first report cannot move up', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect((q('worker-lane-l1-queue-r1-top') as HTMLButtonElement).disabled).toBe(true)
    await click(q('worker-lane-l1-queue-r2-top'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1/queue/move', method: 'POST', body: { reportId: 'r2', to: 'top' } }])
  })

  it('removing a queued report sends only that report', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    await click(q('worker-lane-l1-queue-r2-remove'))
    expect(state.calls[0]).toEqual({ path: '/v1/admin/work/lanes/l1/queue/move', method: 'POST', body: { reportId: 'r2', to: 'remove' } })
  })

  it('pasted report ids (a lane-v4 queue file) go to the end, or to the top', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const input = q('worker-lane-l1-add') as HTMLInputElement
    const ids = ['2000000a-0000-4000-8000-000000000000', '2000000b-0000-4000-8000-000000000000']
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      set.call(input, `${ids[0]}
${ids[1]} ${ids[0]}`)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(q('worker-lane-l1-add-top')!.textContent).toContain('Add 2 to top')
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

describe('lane modes (P3)', () => {
  it('offers the five modes and saves only the mode', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const select = q('worker-lane-l1-mode') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['fix', 'followups', 'conflicts', 'audit', 'skill'])
    await act(async () => {
      select.value = 'conflicts'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1', method: 'PATCH', body: { mode: 'conflicts' } }])
  })

  it('an audit lane sets its veto model; a conflict and an audit run show as text, with their counts', async () => {
    const data = fixture()
    const lane = data.lanes[0]!
    lane.config.mode = 'audit'
    lane.repo = 'kensaurus/glot.it'
    lane.active = [{ claimId: 'c8', kind: 'conflict', reportId: null, title: 'Merge conflict on kensaurus/glot.it#7', since: '2026-10-27T11:50:00Z', leaseUntil: '2026-10-27T12:35:00Z', fromQueue: false }]
    lane.recent = [{ claimId: 'c3', kind: 'audit', reportId: null, title: 'Code-read audit pass', outcome: 'filed', failureKind: null, prUrl: null, detail: 'src/a.tsx: 1 filed', claimedAt: '2026-10-27T11:00:00Z', finishedAt: '2026-10-27T11:10:00Z', autoRequeued: false }]
    lane.counts7d = { ...lane.counts7d, runs: 3, filed: 1 }
    state.data = data
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const card = q('worker-lane-l1')!
    expect(card.textContent).toContain('(kensaurus/glot.it)')
    expect(card.textContent).toContain('3 screens read, 1 with findings filed')
    expect(q('worker-lane-l1-mode-hint')!.textContent).toMatch(/files only those its own check reproduces/)
    expect(card.querySelector('a[href="/reports/null"]')).toBeNull()
    expect(card.textContent).toContain('Merge conflict on kensaurus/glot.it#7')
    expect(q('worker-lane-l1-recent')!.textContent).toContain('Filed findings')
    // An audit lane finds its own work: no queue to fill.
    expect(q('worker-lane-l1-queue')).toBeNull()
    expect(q('worker-lane-l1-add')).toBeNull()

    const input = q('worker-lane-l1-review-model') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'claude-opus-5-5-medium')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('worker-lane-l1-review-model-save'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1', method: 'PATCH', body: { review_model: 'claude-opus-5-5-medium' } }])
  })

  it('"Send to my local worker" offers only lanes that fix reports', async () => {
    const data = fixture()
    data.lanes[0]!.config.mode = 'conflicts'
    state.data = data
    await render(createElement(SendToWorkerButton, { projectId: 'p1', reportIds: ['r7'] }))
    expect(q('send-to-worker')).toBeNull()
  })
})

describe('SendToWorkerButton', () => {
  it('puts the report at the top of your only lane for the app (fix next)', async () => {
    await render(createElement(SendToWorkerButton, { projectId: 'p1', reportIds: ['r7'] }))
    expect(state.paths[0]).toBe('/v1/admin/work/lanes?projectId=p1')
    await click(q('send-to-worker'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1/queue', method: 'PUT', body: { reportIds: ['r7'], front: true } }])
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

describe('worker problems are loud and fixable (ADR 0048 amendment 2026-10-28)', () => {
  function withIncident(): WorkLanesData {
    const data = fixture()
    data.hosts[0]!.status = {
      ...data.hosts[0]!.status,
      load1: 37,
      cpus: 16,
      checks: { cursor: { result: 'timed_out', ageSec: 900, detail: 'timed out after 90 s', account: 's***@g***.com' }, gh: { result: 'signed_in', ageSec: 60, detail: '' } },
      slots: [{ lane: 'glot', runId: 'c9', kind: 'fix', ageSec: 4 * 3600 + 600, stage: 'commit', stageSec: 4 * 3600 }],
      waitWhy: "6 agents running, the host's cap is 6",
    }
    data.lanes[0]!.status = { state: 'working', runs: 4, inflight: [{ runId: 'c9', kind: 'fix', reportId: 'r9', ageSec: 4 * 3600 + 600, stage: 'commit', stageSec: 4 * 3600, model: 'grok-4.7-xhigh-fast', log: ['commit: pnpm exec tsc --noEmit'] }] }
    data.flags = [
      {
        id: 'run_stuck:c9',
        kind: 'run_stuck',
        severity: 'danger',
        hostId: 'h1',
        hostname: 'alienware',
        laneId: 'l1',
        laneName: 'glot',
        projectId: 'p1',
        title: 'glot: a run has held an agent space for 4 h 10 min',
        cause: "It has been in the repo's own commit hook (git commit) for 4 h.",
        sinceSec: 4 * 3600 + 600,
        stage: 'commit',
        log: ['commit: pnpm exec tsc --noEmit'],
        actions: [
          { kind: 'stop_run', label: 'Stop this run', claimId: 'c9' },
          { kind: 'open_report', label: 'Open the report', reportId: 'r9' },
          { kind: 'copy_command', label: 'Find it on the machine', command: "ps -eo pid,etime,stat,args | grep -E 'git (commit|push)' | grep -v grep" },
        ],
      },
      {
        id: 'account_check:h1',
        kind: 'account_check',
        severity: 'warn',
        hostId: 'h1',
        hostname: 'alienware',
        laneId: null,
        laneName: null,
        projectId: null,
        title: 'The Cursor account check timed out on alienware',
        cause: '`cursor-agent status` did not answer in time under load 37 on 16 cores 15 min ago.',
        sinceSec: 900,
        actions: [
          { kind: 'recheck_account', label: 'Re-check the account', hostId: 'h1' },
          { kind: 'copy_command', label: 'Check it on the machine', command: 'cursor-agent status' },
        ],
      },
    ]
    return data
  }
  const buttonByText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null

  it('shows a stuck run first: what, why, its stage and last log lines, and the command for the machine', async () => {
    state.data = withIncident()
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const list = q('worker-flags')!
    // The status, above the cards, counts the problems once (round-2 review, 2026-11-18).
    expect(q('workers-status')!.textContent).toContain('2 things stop your local workers from fixing bugs (1 needs you now).')
    expect(q('workers-status')!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(list.textContent).toContain('An agent space is one coding agent running at a time')
    const stuck = q('worker-flag-run_stuck')!
    expect(stuck.textContent).toContain('Stuck run')
    expect(stuck.textContent).toContain('glot: a run has held an agent space for 4 h 10 min')
    expect(stuck.textContent).toContain('for 4 h 10 min')
    expect(q('worker-flag-run_stuck-stage')!.textContent).toContain("in the repo's commit hook")
    expect(q('worker-flag-run_stuck-log')!.textContent).toContain('commit: pnpm exec tsc --noEmit')
    expect(stuck.textContent).toContain('Find it on the machine, on alienware:')
    expect(stuck.textContent).toContain("ps -eo pid,etime,stat,args")
    expect(stuck.querySelector('a[href="/reports/r9"]')).not.toBeNull()
    // The status line counts the problems, never "all fine", and does not restate the first card.
    expect(q('workers-status')!.textContent).not.toContain('glot: a run has held an agent space')
    expect(q('workers-status')!.textContent).not.toContain('worker online')
    // The machine card says who holds the spaces, and the account check as it answered.
    expect(q('worker-host-h1-slots')!.textContent).toContain("glot (4 h 10 min, in the repo's commit hook)")
    expect(q('worker-host-h1-checks')!.textContent).toContain('check timed out')
    expect(q('worker-host-h1-checks')!.textContent).toContain('(s***@g***.com) checked 15 min ago: "timed out after 90 s"')
    expect(q('worker-host-h1')!.textContent).toContain('load 37 on 16 cores')
    // The lane card shows the run's stage and log too.
    expect(q('worker-lane-l1-run-c9-detail')!.textContent).toContain("in the repo's commit hook")
    expect(q('worker-lane-l1-run-c9-detail')!.textContent).toContain('for 4 h · run 4 h 10 min · grok-4.7-xhigh-fast')
  })

  it('Stop this run asks first, then ends the claim', async () => {
    state.data = withIncident()
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    await click(q('worker-flag-run_stuck-stop_run'))
    expect(state.calls).toEqual([])
    await click(buttonByText('Stop the run'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/claims/c9/stop', method: 'POST', body: {} }])
  })

  it('Re-check the account asks the machine', async () => {
    state.data = withIncident()
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    await click(q('worker-flag-account_check-recheck_account'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/hosts/h1/recheck', method: 'POST', body: {} }])
  })

  it('flags show even with no machine registered (a script ran mushi work outside the worker)', async () => {
    state.data = {
      ...fixture(),
      hosts: [],
      lanes: [],
      flags: [{ id: 'unmanaged_run:f1', kind: 'unmanaged_run', severity: 'danger', hostId: null, hostname: null, laneId: null, laneName: null, projectId: 'p1', title: 'A local mushi work run has been running 4 h outside the worker', cause: 'A script on a machine started it.', sinceSec: 4 * 3600, actions: [{ kind: 'open_report', label: 'Open the report', reportId: 'r1' }] }],
    }
    await render(createElement(WorkersPanel, { projectId: null, now: NOW }))
    expect(q('worker-flag-unmanaged_run')!.textContent).toContain('outside the worker')
    expect(q('workers-first-step')).not.toBeNull()
  })

  it('a machine whose CLI predates the telemetry says to update it, never "all fine"', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect(q('worker-host-h1')!.textContent).toContain('does not report its checks')
    expect(q('worker-flags')).toBeNull()
  })
})

describe('every worker flag kind renders loud, with its label, title and fix (ADR 0048 amendment 2026-10-28)', () => {
  const base = { hostId: 'h1', hostname: 'alienware', laneId: null, laneName: null, projectId: 'p1', cause: 'Because.', sinceSec: 1200 }
  const cases: Array<{ kind: string; severity: 'danger' | 'warn'; label: string; title: string; actions?: WorkerFlagAction[] }> = [
    { kind: 'host_offline', severity: 'danger', label: 'Machine offline', title: 'alienware is offline', actions: [{ kind: 'copy_command', label: 'Check the worker on that machine', command: 'systemctl --user status mushi-worker.service --no-pager' }] },
    { kind: 'machine_not_ready', severity: 'danger', label: 'Lane cannot start', title: 'glot on alienware could not start' },
    { kind: 'lanes_waiting', severity: 'danger', label: 'Waiting for an agent space', title: '6 lanes on alienware have waited 3 h for an agent space' },
    { kind: 'gh_signed_out', severity: 'danger', label: 'GitHub sign-in', title: 'gh is not signed in on alienware', actions: [{ kind: 'copy_command', label: 'Sign in on the machine', command: 'gh auth login' }] },
    { kind: 'machine_waiting', severity: 'warn', label: 'Machine waiting', title: 'alienware has taken nothing new for 20 min' },
    { kind: 'machine_busy', severity: 'warn', label: 'Machine overloaded', title: 'alienware is overloaded: load 37 on 16 cores' },
    {
      kind: 'hook_failures',
      severity: 'warn',
      label: 'Git hooks failing',
      title: "glot: 2 runs failed in the repo's git hooks in 24 h",
      actions: [
        { kind: 'pause_lane', label: 'Pause this lane', laneId: 'l1' },
        { kind: 'open_pr', label: 'Open its PR', prUrl: 'https://github.com/kensaurus/glot.it/pull/12' },
      ],
    },
    { kind: 'credits_idle', severity: 'danger', label: 'Credits idle', title: 'Cursor credits idle for 7 h', actions: [{ kind: 'open_page', label: 'Spend credits', to: '/credits' }] },
  ]

  it.each(cases)('$kind: $label', async (c) => {
    state.data = { ...fixture(), flags: [{ ...base, id: `${c.kind}:x`, kind: c.kind, severity: c.severity, title: c.title, actions: c.actions ?? [] }] }
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const el = q(`worker-flag-${c.kind}`)!
    // The kind label and the duration show once: beside the title only when the title does not say them.
    expect(el.textContent!.toLowerCase()).toContain(c.label.toLowerCase())
    expect(el.textContent).toContain(c.title)
    expect(el.textContent!.split('for 20 min').length - 1).toBeLessThanOrEqual(1)
    expect(el.textContent).toContain(c.title.includes('for 20 min') ? c.title : 'for 20 min')
    for (const a of c.actions ?? []) {
      if (a.kind === 'copy_command') expect(el.textContent).toContain(a.command)
      else expect(el.textContent).toContain(a.label)
    }
    // The status line counts the problem; it never says all is well.
    expect(q('workers-status')!.textContent).toContain('1 thing stops your local workers from fixing bugs')
    // Idle credits are a warning, not a failure, whatever the server's severity.
    if (c.kind === 'credits_idle') expect(el.getAttribute('data-tone')).toBe('warn')
  })

  it('Pause this lane sends only paused, and the PR link opens the PR', async () => {
    const hooks = cases.find((c) => c.kind === 'hook_failures')!
    state.data = { ...fixture(), flags: [{ ...base, id: 'hook_failures:l1', kind: hooks.kind, severity: hooks.severity, title: hooks.title, actions: hooks.actions! }] }
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect(q('worker-flag-hook_failures-open_pr')!.getAttribute('href')).toBe('https://github.com/kensaurus/glot.it/pull/12')
    await click(q('worker-flag-hook_failures-pause_lane'))
    expect(state.calls).toEqual([{ path: '/v1/admin/work/lanes/l1', method: 'PATCH', body: { paused: true } }])
  })
})

describe('Workers round-2 review (2026-11-18)', () => {
  it('a lane on an offline machine reads offline, never "idle" and "Taking reports"', async () => {
    const data = fixture()
    data.hosts[0]!.online = false
    data.lanes[0]!.status = { state: 'idle' }
    state.data = data
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const lane = q('worker-lane-l1')!
    expect(lane.querySelector('[data-testid="status-pill"]')!.textContent).toBe('offline')
    expect(lane.textContent).not.toContain('Taking reports')
    expect(lane.textContent).toContain('Takes reports once alienware is back')
  })

  it('a lane whose stop date passed says so', async () => {
    const data = fixture()
    data.lanes[0]!.config = { ...data.lanes[0]!.config, stop_at: new Date(NOW - 4 * 86_400_000).toISOString() }
    state.data = data
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect(q('worker-lane-l1')!.querySelector('[data-testid="status-pill"]')!.textContent).toBe('stopped')
    expect(q('worker-lane-l1-stopped')!.textContent).toContain('Its stop date passed')
  })

  it('a long queue shows ten rows and marks a same-title duplicate', async () => {
    const data = fixture()
    data.lanes[0]!.queue = Array.from({ length: 14 }, (_, i) => ({ reportId: `q${i}`, title: i === 12 ? 'Title 3' : `Title ${i}`, severity: 'low', status: 'classified', source: 'console', position: i }))
    state.data = data
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect(q('worker-lane-l1-queue')!.querySelectorAll('li[data-testid^="worker-lane-l1-queue-q"]').length).toBe(10)
    await act(async () => q('worker-lane-l1-queue-toggle')!.click())
    expect(q('worker-lane-l1-queue')!.querySelectorAll('li[data-testid^="worker-lane-l1-queue-q"]').length).toBe(14)
    expect(q('worker-lane-l1-queue-q12-dupe')!.textContent).toBe('same as #4')
    expect(q('worker-lane-l1')!.textContent).toContain('Queue (14, 1 with the same title as one above)')
  })
})

describe('lane helpers', () => {
  it('groups last runs with the same outcome and error; a run with no detail stands alone', () => {
    const run = (id: string, detail: string | null, outcome = 'failed') => ({ claimId: id, reportId: `r-${id}`, title: id, outcome, failureKind: 'infra' as const, prUrl: null, detail, claimedAt: '2026-11-17T00:00:00Z', finishedAt: null, autoRequeued: false })
    const groups = groupRecentRuns([run('a', 'git fetch failed: bad object'), run('b', 'git fetch failed: bad object'), run('c', null, 'pr_opened'), run('d', 'other')])
    expect(groups.map((g) => g.runs.map((r) => r.claimId))).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('says shared lane settings once, and nothing when lanes differ in all of them', () => {
    const lane = (model: string, concurrency: number) => ({ config: { ...fixture().lanes[0]!.config, model, concurrency } })
    expect(commonLaneSettings([lane('m', 1), lane('m', 1)])).toMatchObject({ model: 'm', concurrency: 1 })
    expect(commonLaneSettings([lane('m', 1), lane('n', 1)])!.model).toBeUndefined()
    expect(commonLaneSettings([lane('m', 1)])).toBeNull()
    expect(queueDuplicates([{ reportId: 'a', title: 'X' }, { reportId: 'b', title: ' x ' }, { reportId: 'c', title: 'Y' }])).toEqual([null, 1, null])
  })

  it('reports queued counts each report once across lanes', () => {
    const data = fixture()
    const q = data.lanes[0]!.queue
    data.lanes.push({ ...data.lanes[0]!, id: 'l2', queue: [q[0]!] })
    expect(workersSummary(data, NOW).queued).toBe(q.length)
  })
})

describe('Workers round-3 review (2026-11-19)', () => {
  function offlineMachine(): WorkLanesData {
    const data = fixture()
    // Last heartbeat 35 h ago; the machine's last word still says it was working.
    data.hosts[0] = {
      ...data.hosts[0]!,
      online: false,
      lastHeartbeatAt: new Date(NOW - 35 * 3600_000).toISOString(),
      status: {
        state: 'working',
        agents: 2,
        checks: { cursor: { result: 'expected', ageSec: 1020, detail: '', account: 's***@g***.com' }, gh: { result: 'signed_in', ageSec: 60, detail: '' } },
        slots: [{ lane: 'glot', runId: 'c9', kind: 'fix', ageSec: 180, stage: 'agent', stageSec: 30 }],
      },
    }
    data.lanes[0]!.status = { state: 'working', inflight: [{ runId: 'c9', kind: 'fix', reportId: 'r9', ageSec: 180, stage: 'agent', stageSec: 30, model: null, log: [] }] }
    return data
  }
  const pills = (el: Element) => [...el.querySelectorAll('[data-testid="status-pill"]')].map((p) => p.getAttribute('data-status'))

  it('an offline machine shows its last word as the past: no "working", no agents in use, no running pill', async () => {
    state.data = offlineMachine()
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const heartbeat = q('worker-host-h1-heartbeat')!.textContent!
    expect(heartbeat).toContain('35 h ago')
    expect(heartbeat).not.toContain('working')
    expect(heartbeat).not.toContain('agents')
    expect(q('worker-host-h1-slots')!.textContent).toContain('At its last heartbeat')
    expect(q('worker-host-h1-slots')!.textContent).not.toContain('in use')
    expect(q('worker-host-h1-slots')!.textContent).not.toContain('coding agent at work')
    // The account check's age counts from now, not from the last heartbeat.
    expect(q('worker-host-h1-checks')!.textContent).toContain('checked 35 h ago')
    expect(pills(q('worker-host-h1-checks')!)).toEqual(['idle', 'idle'])
    // The lane: its last heartbeat, never "Working on now" with a pulsing pill.
    expect(q('worker-lane-l1-now-heading')!.textContent).toContain('At its last heartbeat')
    const detail = q('worker-lane-l1-run-c9-detail')!
    expect(pills(detail)).toEqual(['idle'])
    expect(detail.textContent).not.toContain('under a minute')
    expect(q('worker-lane-l1')!.querySelector('[data-status="running"]')).toBeNull()
    // The machine's offline state is said on the machine; the lane's is grey, not a red cross.
    expect(q('worker-lane-l1')!.querySelector('[data-testid="status-pill"]')!.getAttribute('data-status')).toBe('idle')
  })

  it('a quiet lane (empty queue, nothing running) is one line until opened', async () => {
    const data = fixture()
    data.lanes[0]!.queue = []
    data.lanes[0]!.active = []
    state.data = data
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const lane = q('worker-lane-l1')!
    expect(lane.getAttribute('data-quiet')).toBe('true')
    expect(lane.textContent).toContain('4 runs, 1 PRs')
    expect(q('worker-lane-l1-add')).toBeNull()
    expect(lane.textContent).not.toContain('Drain')
    await click(q('worker-lane-l1-expand'))
    expect(q('worker-lane-l1-add')).not.toBeNull()
    expect(q('worker-lane-l1')!.textContent).toContain('Drain')
  })

  it('lanes are divider rows in one card, not cards in a card', async () => {
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect(q('workers-lanes-list')!.className).toContain('divide-y')
    expect(q('worker-lane-l1')!.className).not.toMatch(/(^|\s)border(\s|$)/)
    expect(q('worker-lane-l1-queue')!.className).not.toContain('rounded')
  })

  it('no worker yet is one solid line with its action, not a dashed box', async () => {
    state.data = { ...fixture(), hosts: [], lanes: [], flags: [] }
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    expect(q('workers-first-step')!.tagName).toBe('P')
    expect(q('workers-first-step')!.className).not.toContain('dashed')
    expect(q('workers-create-key')!.textContent).toBe('Create a worker key')
  })

  it('a link back to the Workers tab is dropped from a card on the Workers tab', async () => {
    state.data = {
      ...fixture(),
      flags: [{ id: 'credits_idle:x', kind: 'credits_idle', severity: 'danger', hostId: 'h1', hostname: 'alienware', laneId: null, laneName: null, projectId: 'p1', title: 'Cursor credits idle for 34 h', cause: '', sinceSec: 60, actions: [{ kind: 'open_page', label: 'Open Workers', to: '/pipeline?tab=workers' }, { kind: 'open_page', label: 'Spend credits', to: '/credits' }] }],
    }
    await render(createElement(WorkersPanel, { projectId: 'p1', now: NOW }))
    const card = q('worker-flag-credits_idle')!
    expect(card.textContent).not.toContain('Open Workers')
    expect(card.textContent).toContain('Spend credits')
    expect(isWorkersTabLink({ kind: 'open_page', label: 'x', to: '/pipeline?scope=all&tab=workers' })).toBe(true)
    expect(isWorkersTabLink({ kind: 'open_page', label: 'x', to: '/pipeline?tab=workers#workers-lanes' })).toBe(true)
    expect(isWorkersTabLink({ kind: 'open_page', label: 'x', to: '/pipeline' })).toBe(false)
  })

  it('groups successes by outcome and says what went right', () => {
    const run = (id: string, outcome: string, detail: string | null) => ({ claimId: id, reportId: `r-${id}`, title: id, outcome, failureKind: null, prUrl: null, detail, claimedAt: '2026-11-17T00:00:00Z', finishedAt: null, autoRequeued: false })
    const groups = groupRecentRuns([run('a', 'gone', 'fix already on origin/main at abc'), run('b', 'gone', 'fix already on origin/main at def'), run('c', 'pr_opened', 'pull request opened'), run('d', 'pr_opened', 'pull request opened')])
    expect(groups.map((g) => g.runs.map((r) => r.claimId))).toEqual([['a', 'b'], ['c', 'd']])
    expect(recentGroupText(groups[1]!.runs)).toBe('2 runs opened a PR')
    expect(recentGroupText(groups[0]!.runs)).toBe('2 runs were already fixed')
    expect(recentGroupText([run('x', 'failed', 'e'), run('y', 'failed', 'e')])).toBe('2 runs ended with the same error')
  })
})
