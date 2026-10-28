/**
 * FILE: packages/server/supabase/functions/merge-queue/worker.test.ts
 * PURPOSE: One "Merge when ready" tick (ADR 0041) against a fake database,
 *          GitHub and Cursor: behind → update branch, conflict → one agent,
 *          clean → gated merge pinned to the head, a stale merge verdict →
 *          wait for the re-review, one PR per repo per tick.
 *
 * Run with:
 *   cd packages/server/supabase/functions && deno test --no-lock --node-modules-dir merge-queue/worker.test.ts
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { PullRequestDetails } from '../_shared/github.ts'
import { pickConflictRows, processRow, runMergeQueue, type MergeQueueDeps, type QueueRow } from './worker.ts'

const { test } = Deno

function assertEquals(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`)
}

type Row = Record<string, unknown>

/** Just enough of the PostgREST builder for the worker: filters, update, insert, single reads. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; value: Row }> = []
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])]
    let patch: Row | null = null
    let inserted: Row | null = null
    const b: Record<string, unknown> = {}
    const chain = (fn: () => void) => (..._a: unknown[]) => (fn(), b)
    b.select = chain(() => {})
    b.order = chain(() => {})
    b.limit = chain(() => {})
    b.or = chain(() => {})
    b.eq = (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), b)
    b.in = (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), b)
    // PostgREST `is.null`: a column the fixture leaves out reads as null.
    b.is = (col: string, v: unknown) => ((rows = rows.filter((r) => (v === null ? r[col] == null : r[col] === v))), b)
    b.update = (p: Row) => ((patch = p), b)
    b.insert = (p: Row) => ((inserted = p), b)
    b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
    b.then = (ok: (v: unknown) => unknown) => {
      if (patch) {
        for (const r of rows) {
          Object.assign(r, patch)
          writes.push({ table, op: 'update', value: { id: r.id, ...patch } })
        }
      }
      if (inserted) writes.push({ table, op: 'insert', value: inserted })
      return Promise.resolve({ data: rows, error: null }).then(ok)
    }
    return b
  }
  return { db: { from } as unknown as SupabaseClient, writes }
}

const attempt = {
  id: 'fa1',
  project_id: 'p1',
  report_id: 'r1',
  agent: 'cursor_cloud',
  branch: 'cursor/fix-1',
  commit_sha: 'h1',
  pr_url: 'https://github.com/o/r/pull/7',
  pr_number: 7,
  repo_id: null,
  summary: 'Null check on the cart page',
}

function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    id: 'q1',
    fix_attempt_id: 'fa1',
    project_id: 'p1',
    repo: 'o/r',
    pr_number: 7,
    state: 'queued',
    detail: null,
    head_sha: null,
    queued_by: 'u1',
    conflict_agents: 0,
    cursor_agent_id: null,
    agent_started_at: null,
    agent_head_sha: null,
    ...over,
  }
}

function pull(over: Partial<PullRequestDetails> = {}): PullRequestDetails {
  return {
    state: 'open',
    merged: false,
    draft: false,
    mergeable: true,
    mergeableState: 'clean',
    headSha: 'h1',
    headRef: 'cursor/fix-1',
    baseRef: 'main',
    ...over,
  } as PullRequestDetails
}

function deps(over: Partial<MergeQueueDeps> = {}): MergeQueueDeps {
  return {
    now: () => new Date('2026-10-23T09:00:00Z'),
    token: () => Promise.resolve('gh-token'),
    pull: () => Promise.resolve(pull()),
    checks: () => Promise.resolve({ pending: 0, failed: [] }),
    finalize: (() => Promise.resolve({ justMerged: true, reportStatus: 'fixed' })) as never,
    cursorKey: () => Promise.resolve({ ok: true, apiKey: 'ck', model: 'grok-4.7' }),
    updateBranch: () => Promise.reject(new Error('unexpected update')),
    ready: () => Promise.reject(new Error('unexpected ready')),
    merge: () => Promise.reject(new Error('unexpected merge')),
    requeueReview: () => Promise.reject(new Error('unexpected requeue')),
    createAgent: () => Promise.reject(new Error('unexpected agent')),
    agentDone: () => Promise.resolve({ done: false, result: null }),
    behindBy: () => Promise.resolve(0),
    ...over,
  }
}

function setup(qRow: QueueRow) {
  return fakeDb({ fix_attempts: [{ ...attempt }], fix_merge_queue: [{ ...qRow }], fix_events: [] })
}

const lastState = (writes: Array<{ table: string; value: Row }>) =>
  writes.filter((w) => w.table === 'fix_merge_queue' && 'state' in w.value).at(-1)?.value

test('a branch behind its base is updated, and waits for CI on the new head', async () => {
  const { db, writes } = setup(row())
  let updated = 0
  const out = await processRow(db, row(), deps({
    pull: () => Promise.resolve(pull({ mergeableState: 'behind' })),
    updateBranch: () => (updated++, Promise.resolve({ ok: true, conflict: false })),
  }))
  assertEquals(out, 'updated')
  assertEquals(updated, 1)
  assertEquals(lastState(writes)?.state, 'waiting')
})

test('a clean PR with green CI is merged through the gate, pinned to the head it checked', async () => {
  const { db, writes } = setup(row())
  let input: Record<string, unknown> | null = null
  const out = await processRow(db, row(), deps({
    merge: ((_db: unknown, i: Record<string, unknown>) => {
      input = i
      return Promise.resolve({ ok: true, result: { merged: true }, gate: {}, audit: {} })
    }) as never,
  }))
  assertEquals(out, 'merged')
  assertEquals([input!.caller, input!.expectedHeadSha, input!.reason], ['service', 'h1', 'merge_queue'])
  assertEquals(lastState(writes)?.state, 'merged')
  assertEquals(writes.some((w) => w.table === 'fix_events' && (w.value as Row).kind === 'merge_queue'), true)
})

test('a stale "merge" verdict after an update waits for the re-review instead of blocking', async () => {
  const { db, writes } = setup(row())
  let requeued = 0
  const out = await processRow(db, row(), deps({
    merge: (() => Promise.resolve({ ok: false, status: 409, code: 'REVIEW_NOT_MERGE', message: 'x', review: { verdict: 'merge', stale: true, rerunning: false } })) as never,
    requeueReview: (() => (requeued++, Promise.resolve('requeued'))) as never,
  }))
  assertEquals(out, 'waiting')
  assertEquals(requeued, 1)
})

test('a hold blocks; failed CI blocks with the check names', async () => {
  const held = setup(row())
  const out = await processRow(held.db, row(), deps({
    merge: (() => Promise.resolve({ ok: false, status: 409, code: 'REVIEW_HOLD', message: 'Opus said hold.', review: { verdict: 'hold', stale: false, rerunning: false } })) as never,
  }))
  assertEquals(out, 'blocked')
  assertEquals(String(lastState(held.writes)?.detail).includes('only you can override it'), true)

  const red = setup(row())
  const out2 = await processRow(red.db, row(), deps({ checks: () => Promise.resolve({ pending: 0, failed: ['required'] }) }))
  assertEquals(out2, 'blocked')
  assertEquals(String(lastState(red.writes)?.detail).startsWith('CI failed: "required".'), true)
})

test('a conflict starts one Cursor agent on the PR branch; at the cap it needs a person', async () => {
  const { db, writes } = setup(row())
  const created: Row[] = []
  const out = await processRow(db, row(), deps({
    pull: () => Promise.resolve(pull({ mergeable: false, mergeableState: 'dirty' })),
    createAgent: ((_k: string, input: Row) => (created.push(input), Promise.resolve({ agentId: 'a1' }))) as never,
  }))
  assertEquals(out, 'resolving')
  assertEquals([created[0].prUrl, created[0].workOnCurrentBranch, created[0].autoCreatePR, created[0].model], ['https://github.com/o/r/pull/7', true, false, 'grok-4.7'])
  assertEquals(lastState(writes)?.conflict_agents, 1)

  const capped = setup(row({ conflict_agents: 2 }))
  const out2 = await processRow(capped.db, row({ conflict_agents: 2 }), deps({
    pull: () => Promise.resolve(pull({ mergeable: false, mergeableState: 'dirty' })),
    createAgent: () => Promise.reject(new Error('must not start')),
  }))
  assertEquals(out2, 'blocked')
})

test('a conflict without follow-ups on says why instead of starting an agent', async () => {
  const { db, writes } = setup(row())
  const out = await processRow(db, row(), deps({
    pull: () => Promise.resolve(pull({ mergeable: false, mergeableState: 'dirty' })),
    cursorKey: () => Promise.resolve({ ok: false, reason: 'Review follow-ups are off.' }),
  }))
  assertEquals(out, 'blocked')
  assertEquals(lastState(writes)?.detail, 'Merge conflict. Review follow-ups are off.')
})

test('a resolving row continues once the agent pushed a new head', async () => {
  const r = row({ state: 'resolving', cursor_agent_id: 'a1', agent_head_sha: 'h1', agent_started_at: '2026-10-23T08:30:00Z', conflict_agents: 1 })
  const { db, writes } = setup(r)
  const out = await processRow(db, r, deps({ pull: () => Promise.resolve(pull({ headSha: 'h2' })) }))
  assertEquals(out, 'resolved')
  assertEquals(lastState(writes)?.state, 'waiting')
})

test('a tick takes one PR per repo, and a blocked row only where nothing else moves', async () => {
  const rows = [
    row({ id: 'a', repo: 'o/r', state: 'waiting' }),
    row({ id: 'b', repo: 'o/r', state: 'queued' }),
    row({ id: 'c', repo: 'o/r', state: 'blocked' }),
    row({ id: 'd', repo: 'o/s', state: 'blocked' }),
  ].map((r) => ({ ...r, claimed_until: null }))
  const { db } = fakeDb({ fix_attempts: [{ ...attempt }], fix_merge_queue: rows, fix_events: [] })
  const seen: string[] = []
  await runMergeQueue(db, deps({
    pull: (_t, ref) => (seen.push(ref.repo), Promise.resolve(pull({ state: 'closed' }))),
  }))
  assertEquals(seen.sort(), ['r', 's'])
})

test('a repo keeps working on the PR already in progress when a whole app was queued at once', async () => {
  const at = '2026-10-23T08:00:00Z'
  const rows = [
    row({ id: 'q-new', repo: 'o/r', state: 'queued', pr_number: 3 }),
    row({ id: 'q-ci', repo: 'o/r', state: 'waiting', pr_number: 9 }),
    row({ id: 'q-old', repo: 'o/r', state: 'queued', pr_number: 1 }),
    row({ id: 'q-leased', repo: 'o/s', state: 'queued', pr_number: 2 }),
    row({ id: 'q-other', repo: 'o/s', state: 'queued', pr_number: 4 }),
  ].map((r) => ({ ...r, queued_at: at, claimed_until: r.id === 'q-leased' ? '2026-10-23T09:03:00Z' : null }))
  const { db } = fakeDb({ fix_attempts: [{ ...attempt }], fix_merge_queue: rows, fix_events: [] })
  const seen: number[] = []
  await runMergeQueue(db, deps({
    pull: (_t, _ref, n) => (seen.push(n), Promise.resolve(pull({ state: 'closed' }))),
  }))
  // o/r: the waiting PR #9, not a tie-broken queued one; o/s: held by the leased row.
  assertEquals(seen, [9])
})

test('a PR held on red CI is updated when its base moved, and stays held when it did not', async () => {
  const red = { pending: 0, failed: ['gate'] }
  const moved = setup(row({ state: 'blocked' }))
  let updated = 0
  const out = await processRow(moved.db, row({ state: 'blocked' }), deps({
    checks: () => Promise.resolve(red),
    pull: () => Promise.resolve(pull({ mergeableState: 'blocked' })),
    behindBy: () => Promise.resolve(3),
    updateBranch: () => (updated++, Promise.resolve({ ok: true, conflict: false })),
  }))
  assertEquals([out, updated, lastState(moved.writes)?.state], ['updated', 1, 'waiting'])

  const same = setup(row({ state: 'blocked' }))
  const out2 = await processRow(same.db, row({ state: 'blocked' }), deps({
    checks: () => Promise.resolve(red),
    pull: () => Promise.resolve(pull({ mergeableState: 'blocked' })),
    behindBy: () => Promise.resolve(0),
  }))
  assertEquals([out2, lastState(same.writes)?.state], ['blocked', 'blocked'])
})

test('in a train app, conflicting PRs get agents even though the train holds the repo; two at a time', async () => {
  // 2026-10-24 to 10-26: the train tick held glot.it every tick, so 14 rows sat in `resolving` with no agent.
  const at = (m: number) => `2026-10-23T08:0${m}:00Z`
  const rows = [
    row({ id: 'q', state: 'queued', pr_number: 5 }),
    row({ id: 'r1', state: 'resolving', pr_number: 7 }),
    row({ id: 'r2', state: 'resolving', pr_number: 8 }),
    row({ id: 'r3', state: 'resolving', pr_number: 9 }),
  ].map((r, i) => ({ ...r, queued_at: at(i), claimed_until: null }))
  const { db, writes } = fakeDb({ fix_attempts: [{ ...attempt }], fix_merge_queue: rows, fix_events: [], project_settings: [{ project_id: 'p1', release_mode: 'train' }] })
  const started: string[] = []
  const unused = () => Promise.reject(new Error('no train should be built'))
  await runMergeQueue(db, deps({
    pull: (_t, _r, n) => Promise.resolve(n === 5 ? pull({ state: 'closed' }) : pull({ mergeable: false, mergeableState: 'dirty' })),
    createAgent: ((_k: string, input: Row) => (started.push(String(input.name)), Promise.resolve({ agentId: 'a' }))) as never,
    train: { branchSha: unused, createBranch: unused, mergeInto: unused, openPr: unused, closePr: unused, deleteBranch: unused, mergeMethod: unused, trainMerge: unused } as never,
  }))
  assertEquals(started, ['Mushi merge conflict #7', 'Mushi merge conflict #8'])
  const r3 = writes.filter((w) => w.table === 'fix_merge_queue' && w.value.id === 'r3').at(-1)?.value
  assertEquals(String(r3?.detail).startsWith('Conflicts with the base branch; waits for a free conflict agent (2 ahead'), true)
})

test('in a train app, a conflict no agent may take stays blocked with the reason instead of flapping', async () => {
  const rows = [row({ id: 'q', state: 'queued', pr_number: 5 })].map((r) => ({ ...r, queued_at: '2026-10-23T08:00:00Z', claimed_until: null }))
  const { db, writes } = fakeDb({ fix_attempts: [{ ...attempt }], fix_merge_queue: rows, fix_events: [], project_settings: [{ project_id: 'p1', release_mode: 'train' }] })
  const unused = () => Promise.reject(new Error('no train should be built'))
  let clock = new Date('2026-10-23T09:00:00Z')
  const d = deps({
    now: () => clock,
    pull: () => Promise.resolve(pull({ mergeable: false, mergeableState: 'dirty' })),
    cursorKey: () => Promise.resolve({ ok: false, reason: 'Review follow-ups are off.' }),
    createAgent: () => Promise.reject(new Error('must not start')),
    train: { branchSha: unused, createBranch: unused, mergeInto: unused, openPr: unused, closePr: unused, deleteBranch: unused, mergeMethod: unused, trainMerge: unused } as never,
  })
  // State changes written for the row in one tick (the fake shares row objects, so the
  // train's `resolving` and the conflict pass's `blocked` can land in the same tick).
  const tick = async (min: number) => {
    clock = new Date(Date.parse('2026-10-23T09:00:00Z') + min * 60_000)
    const before = writes.length
    await runMergeQueue(db, d)
    return writes.slice(before).filter((w) => w.table === 'fix_merge_queue' && 'state' in w.value).map((w) => w.value.state)
  }
  assertEquals(await tick(0), ['resolving', 'blocked'])
  assertEquals([rows[0].state, rows[0].detail], ['blocked', 'Merge conflict. Review follow-ups are off.'])
  assertEquals(await tick(5), [])
  assertEquals(await tick(30), [])
  // An hour later it is offered again, in case follow-ups were turned on.
  assertEquals(await tick(65), ['resolving', 'blocked'])
})

// ── A local worker lane holds the conflict (ADR 0049) ──────────────────────

const LOCAL = 'c0000000-0000-4000-8000-000000000001'
const localRow = (over: Partial<QueueRow> = {}) =>
  row({ state: 'resolving', local_claim_id: LOCAL, agent_head_sha: 'h1', agent_started_at: '2026-10-23T08:30:00Z', conflict_agents: 1, ...over })
const claim = (over: Row = {}) => ({ id: LOCAL, status: 'active', lease_until: '2026-10-23T09:20:00Z', outcome: null, failure_kind: null, detail: null, ...over })

test('a row a local lane holds waits for it: no cloud agent starts, even when the PR still conflicts', async () => {
  const r = localRow()
  const { db, writes } = fakeDb({ fix_attempts: [{ ...attempt }], fix_merge_queue: [{ ...r }], fix_events: [], work_claims: [claim()] })
  const out = await processRow(db, r, deps({
    pull: () => Promise.resolve(pull({ mergeable: false, mergeableState: 'dirty' })),
    createAgent: () => Promise.reject(new Error('a cloud agent must not start on a local row')),
  }))
  assertEquals(out, 'resolving_local')
  assertEquals(lastState(writes), undefined)
})

test("a local lane's pushed merge moves the row on and re-queues the Opus review of the new head", async () => {
  const r = localRow()
  const { db, writes } = fakeDb({ fix_attempts: [{ ...attempt }], fix_merge_queue: [{ ...r }], fix_events: [], work_claims: [claim()] })
  const asked: unknown[] = []
  const out = await processRow(db, r, deps({
    pull: () => Promise.resolve(pull({ headSha: 'h2' })),
    requeueReview: ((_db: unknown, _t: unknown, head: unknown) => (asked.push(head), Promise.resolve('requeued'))) as never,
  }))
  assertEquals(out, 'resolved')
  assertEquals([lastState(writes)?.state, lastState(writes)?.local_claim_id, lastState(writes)?.head_sha], ['waiting', null, 'h2'])
  assertEquals(asked, ['h2'])
})

test('a local claim whose lease ran out frees the row and gives the cap slot back (the machine, not the PR)', async () => {
  const r = localRow()
  const claims = [claim({ lease_until: '2026-10-23T08:59:00Z' })]
  const { db, writes } = fakeDb({ fix_attempts: [{ ...attempt }], fix_merge_queue: [{ ...r }], fix_events: [], work_claims: claims })
  const out = await processRow(db, r, deps({ pull: () => Promise.resolve(pull({ mergeable: false, mergeableState: 'dirty' })) }))
  assertEquals(out, 'blocked')
  const last = lastState(writes)!
  assertEquals([last.state, last.local_claim_id, last.conflict_agents], ['blocked', null, 0])
  assertEquals(String(last.detail).startsWith('Merge conflict:'), true)
  assertEquals(claims[0].status, 'expired')
})

test('a local claim the lane ended on refused checks keeps its cap slot', async () => {
  const r = localRow()
  const { db, writes } = fakeDb({
    fix_attempts: [{ ...attempt }],
    fix_merge_queue: [{ ...r }],
    fix_events: [],
    work_claims: [claim({ status: 'done', outcome: 'refused', detail: 'conflict markers remain in a.ts' })],
  })
  const out = await processRow(db, r, deps({ pull: () => Promise.resolve(pull({ mergeable: false, mergeableState: 'dirty' })) }))
  assertEquals(out, 'blocked')
  const last = lastState(writes)!
  assertEquals('conflict_agents' in last, false)
  assertEquals(String(last.detail).includes('could not resolve it (conflict markers remain in a.ts)'), true)
})

test("a local lane's conflict counts as a running agent in its repo", () => {
  const at = '2026-10-23T08:00:00Z'
  const rows = [
    { id: 'l', repo: 'o/r', cursor_agent_id: null, local_claim_id: LOCAL, state: 'resolving', queued_at: at, pr_number: 1 },
    { id: 'a', repo: 'o/r', cursor_agent_id: null, local_claim_id: null, state: 'resolving', queued_at: at, pr_number: 2 },
    { id: 'b', repo: 'o/r', cursor_agent_id: null, local_claim_id: null, state: 'resolving', queued_at: at, pr_number: 3 },
  ]
  const { work, inLine } = pickConflictRows(rows)
  assertEquals(work.map((r) => r.id), ['l', 'a'])
  assertEquals(inLine.map((x) => [x.row.id, x.ahead]), [['b', 2]])
})

test('a merge-queue tick never leases a row a lane claimed after the tick read it', async () => {
  const tables: Record<string, Row[]> = {
    fix_attempts: [{ ...attempt }],
    fix_merge_queue: [{ ...row({ id: 'q', state: 'waiting', pr_number: 7 }), queued_at: '2026-10-23T08:00:00Z', claimed_until: null }],
    fix_events: [],
  }
  const { db: inner } = fakeDb(tables)
  // The lane's compare-and-set lands between the tick's read and its lease.
  let reads = 0
  const db = {
    from: (t: string) => {
      if (t === 'fix_merge_queue' && ++reads === 2) tables.fix_merge_queue[0] = { ...tables.fix_merge_queue[0], local_claim_id: LOCAL }
      return inner.from(t)
    },
  } as unknown as SupabaseClient
  let pulled = 0
  await runMergeQueue(db, deps({ pull: () => (pulled++, Promise.resolve(pull({ state: 'closed' }))) }))
  assertEquals(pulled, 0)
})
