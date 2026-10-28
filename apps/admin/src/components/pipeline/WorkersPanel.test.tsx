/**
 * @vitest-environment jsdom
 *
 * /pipeline Workers tab (ADR 0048): machines, lanes and queues from
 * GET /v1/admin/work/lanes; pausing a lane sends only `paused`; moving a
 * queue item sends the whole new order; the empty state shows the install
 * command; "Send to my local worker" appends to the only lane; the pipeline's
 * Requeue posts local worker run ids as claimIds. P3 modes: the mode menu
 * offers all five, an audit lane sets its veto model, and a conflict or audit
 * run shows as text (it holds no report).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerFlagAction, WorkLanesData } from '../../lib/workers'

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
    expect(list.textContent).toContain('2 things stop your local workers from fixing bugs (1 need you now).')
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
    // The status line leads with the worst problem, not "all fine".
    expect(q('workers-status')!.textContent).toContain('glot: a run has held an agent space for 4 h 10 min.')
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
    expect(el.textContent).toContain(c.label)
    expect(el.textContent).toContain(c.title)
    expect(el.textContent).toContain('for 20 min')
    for (const a of c.actions ?? []) {
      if (a.kind === 'copy_command') expect(el.textContent).toContain(a.command)
      else expect(el.textContent).toContain(a.label)
    }
    // The status line names the problem; it never says all is well.
    expect(q('workers-status')!.textContent).toContain(c.title)
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
