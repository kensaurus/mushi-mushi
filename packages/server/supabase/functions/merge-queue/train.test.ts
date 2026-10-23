/**
 * FILE: packages/server/supabase/functions/merge-queue/train.test.ts
 * PURPOSE: Release trains (ADR 0044) against a fake database and GitHub:
 *          a due train is built (a conflicting member waits), a green train
 *          merges through the gate and finalizes every member, a red train
 *          is bisected, a member that fails alone is held, and nothing leaves
 *          before the window.
 *
 * Run with:
 *   cd packages/server/supabase/functions && deno test --no-lock --node-modules-dir merge-queue/train.test.ts
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { PullRequestDetails } from '../_shared/github.ts'
import { runTrainTick, type TrainDeps, type TrainQueueRow } from './train.ts'

const { test } = Deno

function assertEquals(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`)
}

type Row = Record<string, unknown>

/** A small PostgREST stand-in: filters, update, insert(+select), single reads, limit. */
function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0
  const from = (table: string) => {
    tables[table] ??= []
    let rows = [...tables[table]]
    let patch: Row | null = null
    let inserted: Row | null = null
    let lim = Infinity
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.order = () => b
    b.or = () => b
    b.limit = (n: number) => ((lim = n), b)
    b.eq = (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), b)
    b.in = (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), b)
    b.update = (p: Row) => ((patch = p), b)
    b.insert = (p: Row) => ((inserted = { id: `${table}-${++seq}`, created_at: '2026-10-24T06:00:00Z', ...p }), tables[table].push(inserted), b)
    const apply = () => {
      if (patch) for (const r of rows) Object.assign(r, patch)
      return inserted ? [inserted] : rows.slice(0, lim)
    }
    b.maybeSingle = () => Promise.resolve({ data: apply()[0] ?? null, error: null })
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: apply(), error: null }).then(ok)
    return b
  }
  return { db: { from } as unknown as SupabaseClient, tables }
}

const NOW = new Date('2026-10-24T06:00:00Z')

function qrow(id: string, pr: number, over: Partial<TrainQueueRow> = {}): TrainQueueRow {
  return { id, fix_attempt_id: `fa-${id}`, project_id: 'p1', repo: 'o/r', pr_number: pr, state: 'queued', queued_at: `2026-10-23T0${pr % 10}:00:00Z`, queued_by: 'u1', train_id: null, ...over }
}

function pull(n: number, over: Partial<PullRequestDetails> = {}): PullRequestDetails {
  return { state: 'open', merged: false, draft: false, mergeable: true, mergeableState: 'clean', headSha: `h${n}`, headRef: `fix/${n}`, baseRef: 'main', title: `fix: thing ${n}`, ...over } as PullRequestDetails
}

function setup(rows: TrainQueueRow[], extra: Record<string, Row[]> = {}) {
  return fakeDb({
    fix_merge_queue: rows.map((r) => ({ ...r })),
    fix_reviews: rows.map((r) => ({ fix_attempt_id: r.fix_attempt_id, verdict: 'merge', head_sha: `h${r.pr_number}`, status: 'completed' })),
    fix_attempts: rows.map((r) => ({ id: r.fix_attempt_id, report_id: `rep-${r.id}`, project_id: 'p1', pr_url: `https://github.com/o/r/pull/${r.pr_number}`, pr_number: r.pr_number })),
    reports: rows.map((r) => ({ id: `rep-${r.id}`, severity: 'medium', source: 'widget' })),
    release_trains: [],
    fix_events: [],
    ...extra,
  })
}

function deps(over: Partial<TrainDeps> = {}): TrainDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    now: () => NOW,
    pull: (_t, _r, n) => Promise.resolve(pull(n)),
    checks: () => Promise.resolve({ pending: 0, failed: [] }),
    updateBranch: () => Promise.resolve({ ok: true, conflict: false }),
    branchSha: () => Promise.resolve('base1'),
    createBranch: (_t, _r, b) => (calls.push(`branch ${b}`), Promise.resolve(true)),
    mergeInto: (_t, _r, _b, head) => (calls.push(`merge ${head}`), Promise.resolve({ outcome: 'merged', sha: `t-${head}` })),
    openPr: (_t, _r, pr) => (calls.push(`open ${pr.title}`), Promise.resolve({ number: 900 })),
    closePr: (_t, _r, n) => (calls.push(`close ${n}`), Promise.resolve()),
    deleteBranch: (_t, _r, b) => (calls.push(`delete ${b}`), Promise.resolve()),
    trainMerge: (() => (calls.push('trainMerge'), Promise.resolve({ ok: true, result: { merged: true, alreadyMerged: false, sha: 'msha' } }))) as never,
    finalize: (() => (calls.push('finalize'), Promise.resolve({ justMerged: true, reportStatus: 'fixed' }))) as never,
    requeueReview: (() => Promise.resolve('requeued')) as never,
    ...over,
  }
}

const settings = { intervalMinutes: 360, maxMembers: 15 }

test('a due train merges every approved PR into one branch and opens one PR; a conflict waits', async () => {
  const rows = [qrow('a', 1), qrow('b', 2), qrow('c', 3)]
  const { db, tables } = setup(rows)
  const d = deps({ mergeInto: (_t, _r, _b, head) => (d.calls.push(`merge ${head}`), Promise.resolve(head === 'h2' ? { outcome: 'conflict' } : { outcome: 'merged', sha: `t-${head}` })) })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'started')
  assertEquals(d.calls, ['branch mushi/train/20261024-0600', 'merge h1', 'merge h2', 'merge h3', 'open release: 2 fixes (2026-10-24)'])
  const q = tables.fix_merge_queue
  assertEquals(q.map((r) => [r.id, r.state, r.train_id != null]), [['a', 'waiting', true], ['b', 'queued', false], ['c', 'waiting', true]])
  assertEquals(tables.release_trains.length, 1)
  assertEquals((tables.release_trains[0].members as Row[]).map((m) => m.prNumber), [1, 3])
})

test('nothing leaves before the window; approved PRs say they wait for the next train', async () => {
  const rows = [qrow('a', 1)]
  const { db, tables } = setup(rows, { release_trains: [{ id: 'old', repo: 'o/r', state: 'merged', created_at: '2026-10-24T04:00:00Z' }] })
  const d = deps()
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'waiting_for_window')
  assertEquals(d.calls, [])
  assertEquals(tables.fix_merge_queue[0].detail, 'Approved; waits for the next release train.')
})

const activeTrain = (members: number[]) => ({
  id: 'tr1',
  project_id: 'p1',
  repo: 'o/r',
  branch: 'mushi/train/20261024-0000',
  base_ref: 'main',
  pr_number: 900,
  head_sha: 'th',
  state: 'testing',
  attempt: 1,
  created_at: '2026-10-24T00:00:00Z',
  members: members.map((n) => ({ rowId: String.fromCharCode(96 + n), fixAttemptId: `fa-${String.fromCharCode(96 + n)}`, prNumber: n, headSha: `h${n}` })),
})

test('a green train merges through the gate and finalizes every member', async () => {
  const rows = [qrow('a', 1, { state: 'waiting', train_id: 'tr1' }), qrow('b', 2, { state: 'waiting', train_id: 'tr1' })]
  const { db, tables } = setup(rows, { release_trains: [activeTrain([1, 2])] })
  const d = deps({ pull: (_t, _r, n) => Promise.resolve(n === 900 ? pull(900, { headSha: 'th', title: 'release: 2 fixes' }) : pull(n)) })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'merged')
  assertEquals(d.calls, ['trainMerge', 'finalize', 'finalize'])
  assertEquals(tables.release_trains[0].state, 'merged')
  assertEquals(tables.fix_merge_queue.map((r) => r.state), ['merged', 'merged'])
})

test('a red train is bisected: its first half rides again, the rest waits', async () => {
  const rows = [1, 2, 3].map((n) => qrow(String.fromCharCode(96 + n), n, { state: 'waiting', train_id: 'tr1' }))
  const { db, tables } = setup(rows, { release_trains: [activeTrain([1, 2, 3])] })
  const d = deps({
    pull: (_t, _r, n) => Promise.resolve(n === 900 ? pull(900, { headSha: 'th' }) : pull(n)),
    checks: () => Promise.resolve({ pending: 0, failed: ['gate'] }),
  })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'started')
  assertEquals(d.calls.slice(0, 2), ['close 900', 'delete mushi/train/20261024-0000'])
  assertEquals(d.calls.filter((c) => c.startsWith('merge ')), ['merge h1', 'merge h2'])
  assertEquals(tables.release_trains[0].state, 'failed')
  const retry = tables.release_trains[1]
  assertEquals([retry.attempt, (retry.members as Row[]).length], [2, 2])
  assertEquals(tables.fix_merge_queue.find((r) => r.id === 'c')?.state, 'queued')
})

test('a member that fails alone is held with the failing check named', async () => {
  const rows = [qrow('a', 1, { state: 'waiting', train_id: 'tr1' })]
  const { db, tables } = setup(rows, { release_trains: [activeTrain([1])] })
  const d = deps({
    pull: (_t, _r, n) => Promise.resolve(n === 900 ? pull(900, { headSha: 'th' }) : pull(n)),
    checks: () => Promise.resolve({ pending: 0, failed: ['Lint & Build'] }),
  })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'held')
  assertEquals(tables.fix_merge_queue[0].state, 'blocked')
  assertEquals(String(tables.fix_merge_queue[0].detail).startsWith('CI failed: Lint & Build.'), true)
})

test('a member taken out of the queue never rides: the train is rebuilt without it', async () => {
  const rows = [qrow('a', 1, { state: 'waiting', train_id: 'tr1' }), qrow('b', 2, { state: 'removed', train_id: 'tr1' })]
  const { db, tables } = setup(rows, { release_trains: [activeTrain([1, 2])] })
  const d = deps({ pull: (_t, _r, n) => Promise.resolve(n === 900 ? pull(900, { headSha: 'th' }) : pull(n)) })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows: [rows[0]], settings }, d)
  assertEquals(out, 'rebuild')
  assertEquals(d.calls, ['close 900', 'delete mushi/train/20261024-0000'])
  assertEquals(tables.release_trains[0].state, 'abandoned')
  assertEquals(tables.fix_merge_queue.map((r) => [r.id, r.state, r.train_id]), [['a', 'queued', null], ['b', 'removed', 'tr1']])
})
