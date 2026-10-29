/**
 * FILE: health-gate.test.ts
 * PURPOSE: "Stop the line" (plan-simplicity-2026-10 Phase 1 unit B, ADR 0054):
 *            - the switch: anything but an exact 'observe' / 'enforce' is off,
 *              and off reads nothing beyond the switch;
 *            - observe never withholds; `unknown` never pauses in any mode; a
 *              stored answer older than an hour reads as unknown;
 *            - recording never throws into a dispatcher;
 *            - invariants: the gate module can only withhold (it imports no
 *              merge, ready or dispatch call), it sits in front of the merge
 *              queue's gated merges, never around them, and a merge-queue tick
 *              in observe mode makes exactly the calls and writes it makes
 *              with the gate off; in enforce it makes a subset.
 *          Spend-down and review-follow-up ticks are compared the same way in
 *          spend-down.test.ts and review-followup.test.ts.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import {
  checksFromStored,
  createHealthGate,
  GATE_MAX_AGE_MS,
  gateVerdict,
  OFF_GATE,
  parseHealthGateMode,
  pausingChecks,
  recordGateDecision,
  type HealthGate,
} from '../../supabase/functions/_shared/health-gate.ts'
import { fromSetupGap, type HealthCheck } from '../../supabase/functions/_shared/health-checks.ts'
import { autofixKeyGap, followupKeyGap, noRepoGap } from '../../supabase/functions/_shared/setup-gaps.ts'
import { runMergeQueue, type MergeQueueDeps } from '../../supabase/functions/merge-queue/worker.ts'

const NOW = new Date('2026-10-29T05:00:00Z')
const P1 = '5000000a-0000-4000-8000-000000000000'
const P2 = '5000000b-0000-4000-8000-000000000000'
const AT = NOW.toISOString()

const deletedKey = fromSetupGap(followupKeyGap({ projectId: P1, settings: { enabled: false, offReason: 'the Cursor key chosen for review follow-ups was deleted.', keyId: null } }), AT)
const noAgent = fromSetupGap(autofixKeyGap({ projectId: P1, dispatcher: { autofixOn: true, server: { agentKeys: 0, offKeys: 0 } } }), AT)
const noGithub = fromSetupGap(noRepoGap(P1), AT)
const unreadable = fromSetupGap(followupKeyGap({ projectId: P1, settings: null }), AT)

describe('the switch', () => {
  it('only an exact observe or enforce turns it on', () => {
    expect(parseHealthGateMode('observe')).toBe('observe')
    expect(parseHealthGateMode(' ENFORCE ')).toBe('enforce')
    for (const v of [undefined, null, '', 'on', 'true', 1, 'observing']) expect(parseHealthGateMode(v)).toBe('off')
  })

  it('off reads nothing beyond the switch and never pauses', async () => {
    const loadChecks = vi.fn(async () => [noAgent])
    const record = vi.fn(async () => {})
    const gate = await createHealthGate(makeFakeDb() as never, 'test', { readMode: async () => 'off', loadChecks, record })
    expect(gate).toBe(OFF_GATE)
    expect((await gate.check(P1, 'autofix')).withhold).toBe(false)
    expect(loadChecks).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('a missing config row, a failed read or a throwing reader is off', async () => {
    expect((await createHealthGate(makeFakeDb({ mushi_runtime_config: [] }) as never, 'test')).mode).toBe('off')
    expect((await createHealthGate(makeFakeDb({}, { failRead: () => 'timeout' }) as never, 'test')).mode).toBe('off')
    expect((await createHealthGate(makeFakeDb() as never, 'test', { readMode: async () => { throw new Error('boom') } })).mode).toBe('off')
    expect((await createHealthGate(makeFakeDb({ mushi_runtime_config: [{ key: 'health_gate_mode', value: 'observe' }] }) as never, 'test')).mode).toBe('observe')
  })
})

describe('verdicts', () => {
  const checks: HealthCheck[] = [deletedKey, noAgent, unreadable]

  it('observe records would-pause but never withholds', () => {
    const v = gateVerdict('observe', checks, 'followups')
    expect(v).toMatchObject({ wouldPause: true, withhold: false })
    expect(v.pausing.map((c) => c.id)).toEqual(['review_followup_key'])
  })

  it('enforce withholds only the automation a problem blocks', () => {
    expect(gateVerdict('enforce', checks, 'followups').withhold).toBe(true)
    expect(gateVerdict('enforce', checks, 'autofix').withhold).toBe(true)
    expect(gateVerdict('enforce', checks, 'train').withhold).toBe(false)
    expect(gateVerdict('enforce', [noGithub], 'train').withhold).toBe(true)
  })

  it('unknown never pauses, in any mode', () => {
    for (const mode of ['off', 'observe', 'enforce'] as const) {
      for (const block of ['autofix', 'followups', 'train'] as const) {
        expect(gateVerdict(mode, [unreadable], block)).toMatchObject({ withhold: false, wouldPause: false })
      }
    }
    expect(pausingChecks([{ ...deletedKey, status: 'unknown' }, { ...deletedKey, status: 'ok' }], 'followups')).toEqual([])
  })

  it('a stored answer over an hour old reads as unknown, so nothing pauses on old news', () => {
    const value = { gaps: [noAgentGap()] }
    const fresh = checksFromStored({ value, checked_at: new Date(NOW.getTime() - GATE_MAX_AGE_MS).toISOString() }, NOW)
    const stale = checksFromStored({ value, checked_at: new Date(NOW.getTime() - GATE_MAX_AGE_MS - 1).toISOString() }, NOW)
    expect(fresh[0].status).toBe('problem')
    expect(stale[0].status).toBe('unknown')
    expect(gateVerdict('enforce', stale, 'autofix').withhold).toBe(false)
    expect(checksFromStored(null, NOW)).toEqual([])
    expect(checksFromStored({ value: { gaps: 'nope' }, checked_at: AT }, NOW)).toEqual([])
  })

  it('a check reader or recorder that throws never pauses and never throws', async () => {
    const gate = await createHealthGate(makeFakeDb() as never, 'test', {
      readMode: async () => 'enforce',
      loadChecks: async () => {
        throw new Error('db down')
      },
      record: async () => {
        throw new Error('counter down')
      },
    })
    await expect(gate.check(P1, 'autofix')).resolves.toMatchObject({ withhold: false })
  })

  it('reads each app once per tick', async () => {
    const loadChecks = vi.fn(async () => [noAgent])
    const gate = await createHealthGate(makeFakeDb() as never, 'test', { readMode: async () => 'observe', loadChecks, record: async () => {} })
    await gate.check(P1, 'autofix')
    await gate.check(P1, 'train')
    expect(loadChecks).toHaveBeenCalledTimes(1)
  })
})

function noAgentGap() {
  return autofixKeyGap({ projectId: P1, dispatcher: { autofixOn: true, server: { agentKeys: 0, offKeys: 0 } } })
}

describe('recording', () => {
  it('counts a would-pause through the shadow counter and ignores a table that is not deployed', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
    const db = makeFakeDb({}, { rpc: (fn, args) => (calls.push({ fn, args }), null) })
    await recordGateDecision(db as never, P1, gateVerdict('observe', [noAgent], 'autofix'), 'spend-down')
    expect(calls).toEqual([{ fn: 'health_gate_record', args: { p_project_id: P1, p_automation: 'spend-down', p_check_ids: ['autofix_agent_key'], p_mode: 'observe' } }])
    const missing = makeFakeDb({}, { rpcError: () => ({ code: 'PGRST202', message: 'Could not find the function' }) })
    await expect(recordGateDecision(missing as never, P1, gateVerdict('observe', [noAgent], 'autofix'), 'spend-down')).resolves.toBeUndefined()
  })

  it('records nothing when nothing would pause', async () => {
    const calls: string[] = []
    const db = makeFakeDb({}, { rpc: (fn) => (calls.push(fn), null) })
    await recordGateDecision(db as never, P1, gateVerdict('observe', [unreadable], 'autofix'), 'spend-down')
    expect(calls).toEqual([])
  })
})

// ── Invariants: the gate only withholds ─────────────────────────────────────

const fnSrc = (rel: string) => readFileSync(resolve(__dirname, '../../supabase/functions', rel), 'utf8')

describe('the gate can only withhold', () => {
  it('the gate module calls no merge, ready, dispatch or agent start', () => {
    const src = fnSrc('_shared/health-gate.ts')
    for (const banned of ['gated-merge', 'gatedMergePullRequest', 'gatedTrainMerge', 'markPullRequestReady', 'mergeGithubPullRequest', 'dispatchFixForReport', 'createCursorAgent', 'fix-merge', "from('fix_merge_queue')", "from('fix_attempts')"]) {
      expect(src, banned).not.toContain(banned)
    }
    // Its only write is the shadow counter.
    expect(src.match(/\.(insert|update|upsert|delete)\(/g) ?? []).toEqual([])
  })

  it('every dispatcher uses the verdict only to skip (continue / return), never to start work', () => {
    const uses: Array<[string, RegExp]> = [
      ['fix-worker/index.ts', /if \(health\.withhold\) \{[\s\S]{0,600}?status: 'skipped'[\s\S]{0,400}?return new Response/],
      ['review-followup/index.ts', /if \(health\.withhold\) \{[\s\S]{0,300}?continue\n/],
      ['spend-down-worker/index.ts', /if \(health\.withhold\) \{[\s\S]{0,200}?continue\n/],
      ['merge-queue/worker.ts', /\.withhold\) \{\n\s+tally\.train_health_paused[\s\S]{0,80}?continue\n/],
    ]
    for (const [file, re] of uses) expect(fnSrc(file), file).toMatch(re)
  })

  it('the merge queue still merges only through gatedMergePullRequest / gatedTrainMerge, untouched by the gate', () => {
    const worker = fnSrc('merge-queue/worker.ts')
    // The gate is consulted before the lease claim, and the merge call keeps its pinned head and service caller.
    expect(worker).toMatch(/await deps\.merge\(db, \{[\s\S]{0,400}caller: 'service'[\s\S]{0,200}expectedHeadSha: head,\n\s+override: false,/)
    expect(worker).not.toMatch(/withhold[\s\S]{0,200}deps\.merge\(/)
    expect(fnSrc('merge-queue/index.ts')).toContain('trainMerge: gatedTrainMerge')
  })
})

// ── A merge-queue tick: observe changes nothing, enforce only withholds ─────

interface Recorded {
  calls: string[]
  db: FakeDb
  tally: Record<string, number>
}

function world(): FakeDb {
  return makeFakeDb({
    fix_merge_queue: [
      { id: 'q1', fix_attempt_id: 'a1', project_id: P1, repo: 'acme/app', pr_number: 11, state: 'queued', detail: null, head_sha: null, queued_by: 'u1', conflict_agents: 0, cursor_agent_id: null, agent_started_at: null, agent_head_sha: null, local_claim_id: null, queued_at: '2026-10-29T01:00:00Z', updated_at: null, claimed_until: null, train_id: null },
      { id: 'q2', fix_attempt_id: 'a2', project_id: P1, repo: 'acme/web', pr_number: 12, state: 'queued', detail: null, head_sha: null, queued_by: 'u1', conflict_agents: 0, cursor_agent_id: null, agent_started_at: null, agent_head_sha: null, local_claim_id: null, queued_at: '2026-10-29T01:01:00Z', updated_at: null, claimed_until: null, train_id: null },
      { id: 'q3', fix_attempt_id: 'a3', project_id: P2, repo: 'acme/other', pr_number: 13, state: 'queued', detail: null, head_sha: null, queued_by: 'u1', conflict_agents: 0, cursor_agent_id: null, agent_started_at: null, agent_head_sha: null, local_claim_id: null, queued_at: '2026-10-29T01:02:00Z', updated_at: null, claimed_until: null, train_id: null },
    ],
    fix_attempts: [
      { id: 'a1', project_id: P1, report_id: 'r1', agent: 'cursor_cloud', branch: 'b1', commit_sha: 'h1', pr_url: 'https://github.com/acme/app/pull/11', pr_number: 11, repo_id: null, summary: 'one' },
      { id: 'a2', project_id: P1, report_id: 'r2', agent: 'cursor_cloud', branch: 'b2', commit_sha: 'h2', pr_url: 'https://github.com/acme/web/pull/12', pr_number: 12, repo_id: null, summary: 'two' },
      { id: 'a3', project_id: P2, report_id: 'r3', agent: 'cursor_cloud', branch: 'b3', commit_sha: 'h3', pr_url: 'https://github.com/acme/other/pull/13', pr_number: 13, repo_id: null, summary: 'three' },
    ],
    fix_events: [],
  })
}

async function tick(gate: HealthGate | undefined): Promise<Recorded> {
  const calls: string[] = []
  const db = world()
  const deps: MergeQueueDeps = {
    now: () => NOW,
    token: async () => 'tok',
    pull: async (_t, ref, n) => {
      calls.push(`pull ${ref.repo}#${n}`)
      // acme/web#12 conflicts (a conflict agent would start); the others are clean.
      const conflict = n === 12
      return { state: 'open', merged: false, draft: false, mergeable: !conflict, mergeableState: conflict ? 'dirty' : 'clean', headSha: `h${n}`, baseRef: 'main', headRef: `b${n}` } as never
    },
    checks: async () => ({ pending: 0, failed: [] }),
    updateBranch: async () => ({ ok: true, conflict: false }),
    behindBy: async () => 0,
    ready: async (_t, ref, n) => {
      calls.push(`ready ${ref.repo}#${n}`)
      return { ok: true }
    },
    merge: (async (_db: unknown, input: { ref: { repo: string }; number: number; expectedHeadSha: string; caller: string }) => {
      calls.push(`merge ${input.ref.repo}#${input.number}@${input.expectedHeadSha} as ${input.caller}`)
      return { ok: true, result: { merged: true } }
    }) as never,
    finalize: (async () => {
      calls.push('finalize')
    }) as never,
    cursorKey: async () => ({ ok: true, apiKey: 'k', model: null }),
    createAgent: async (_k, input) => {
      calls.push(`agent ${input.prUrl}`)
      return { agentId: 'bc-1' }
    },
    agentDone: async () => ({ done: false, result: null }),
    requeueReview: (async () => {}) as never,
    ...(gate ? { healthGate: gate } : {}),
  }
  const tally = await runMergeQueue(db as never, deps)
  return { calls, db, tally }
}

const gateWith = (mode: 'observe' | 'enforce', checks: HealthCheck[]) =>
  createHealthGate(makeFakeDb() as never, 'merge-queue', { readMode: async () => mode, loadChecks: async (_db, pid) => checks.filter((c) => c.projectId === pid), record: async () => {}, now: () => NOW })

const strip = (rows: Array<Record<string, unknown>>) => rows.map(({ updated_at: _u, ...r }) => r)

describe('merge-queue tick under the gate', () => {
  // P1: no GitHub access (stops its train / PR turns) and a deleted follow-up key (stops conflict agents).
  const problems = [noGithub, deletedKey]

  it('observe: the same calls, writes and tally as with the gate off', async () => {
    const off = await tick(undefined)
    const observe = await tick(await gateWith('observe', problems))
    expect(off.calls).toContain('merge app#11@h11 as service')
    expect(off.calls).toContain('agent https://github.com/acme/web/pull/12')
    expect(observe.calls).toEqual(off.calls)
    expect(observe.tally).toEqual(off.tally)
    expect(strip(observe.db.table('fix_merge_queue'))).toEqual(strip(off.db.table('fix_merge_queue')))
    expect(observe.db.table('fix_events').length).toBe(off.db.table('fix_events').length)
  })

  it('enforce: withholds only the paused app, leaves its rows queued, and makes a subset of the calls', async () => {
    const off = await tick(undefined)
    const enforce = await tick(await gateWith('enforce', problems))
    for (const c of enforce.calls) expect(off.calls).toContain(c)
    expect(enforce.calls).toEqual(['pull other#13', 'merge other#13@h13 as service', 'finalize'])
    expect(enforce.tally).toMatchObject({ health_paused: 2, merged: 1 })
    const q = new Map(enforce.db.table('fix_merge_queue').map((r) => [r.id, r]))
    expect(q.get('q1')).toMatchObject({ state: 'queued', claimed_until: null })
    expect(q.get('q2')).toMatchObject({ state: 'queued', claimed_until: null })
    expect(q.get('q3')).toMatchObject({ state: 'merged' })
  })

  it('enforce with only the follow-up key broken: the clean PR still merges, the conflict waits without an agent', async () => {
    const enforce = await tick(await gateWith('enforce', [deletedKey]))
    expect(enforce.calls).toContain('merge app#11@h11 as service')
    expect(enforce.calls.some((c) => c.startsWith('agent '))).toBe(false)
    const q2 = enforce.db.table('fix_merge_queue').find((r) => r.id === 'q2')!
    expect(q2.state).toBe('queued')
    expect(String(q2.detail)).toContain('Paused until this is fixed: Review follow-up key')
    expect(enforce.tally).toMatchObject({ conflict_health_paused: 1, merged: 2 })
    expect(enforce.tally.health_paused).toBeUndefined()
  })

  it('an unknown check pauses nothing even in enforce', async () => {
    const off = await tick(undefined)
    const enforce = await tick(await gateWith('enforce', [unreadable, { ...noGithub, status: 'unknown' }]))
    expect(enforce.calls).toEqual(off.calls)
  })
})
