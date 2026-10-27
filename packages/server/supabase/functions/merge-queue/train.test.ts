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
    ready: (_t, _r, n) => (calls.push(`ready ${n}`), Promise.resolve({ ok: true })),
    branchSha: () => Promise.resolve('base1'),
    createBranch: (_t, _r, b) => (calls.push(`branch ${b}`), Promise.resolve(true)),
    mergeInto: (_t, _r, _b, head) => (calls.push(`merge ${head}`), Promise.resolve({ outcome: 'merged', sha: `t-${head}` })),
    openPr: (_t, _r, pr) => (calls.push(`open ${pr.title}`), Promise.resolve({ number: 900 })),
    closePr: (_t, _r, n) => (calls.push(`close ${n}`), Promise.resolve()),
    deleteBranch: (_t, _r, b) => (calls.push(`delete ${b}`), Promise.resolve()),
    mergeMethod: () => Promise.resolve('merge'),
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
  assertEquals(d.calls, ['branch mushi/train/20261024-0600', 'merge h1', 'merge h2', 'merge h3', 'open fix: release train, 2 fixes (2026-10-24)'])
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
    checks: (_t, _r, sha) => Promise.resolve({ pending: 0, failed: sha === 'th' ? ['gate'] : [] }),
  })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'started')
  assertEquals(d.calls.slice(0, 2), ['close 900', 'delete mushi/train/20261024-0000'])
  assertEquals(d.calls.filter((c) => c.startsWith('merge ')), ['merge h1', 'merge h2'])
  assertEquals([tables.release_trains[0].state, tables.release_trains[0].detail], ['failed', 'Members failed CI: "gate".'])
  const retry = tables.release_trains[1]
  assertEquals([retry.attempt, (retry.members as Row[]).length], [2, 2])
  assertEquals(tables.fix_merge_queue.find((r) => r.id === 'c')?.state, 'queued')
})

test('a member that fails alone is held with the failing check named', async () => {
  const rows = [qrow('a', 1, { state: 'waiting', train_id: 'tr1' })]
  const { db, tables } = setup(rows, { release_trains: [activeTrain([1])] })
  const d = deps({
    pull: (_t, _r, n) => Promise.resolve(n === 900 ? pull(900, { headSha: 'th' }) : pull(n)),
    checks: (_t, _r, sha) => Promise.resolve({ pending: 0, failed: sha === 'th' ? ['Lint & Build'] : [] }),
  })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'held')
  assertEquals(tables.fix_merge_queue[0].state, 'blocked')
  assertEquals(String(tables.fix_merge_queue[0].detail).startsWith('CI failed: "Lint & Build".'), true)
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

test('a linear-history repo gets a squash; each member PR is then closed as shipped', async () => {
  const rows = [qrow('a', 1, { state: 'waiting', train_id: 'tr1' }), qrow('b', 2, { state: 'waiting', train_id: 'tr1' })]
  const { db, tables } = setup(rows, { release_trains: [activeTrain([1, 2])] })
  let method: unknown = null
  const d = deps({
    pull: (_t, _r, n) => Promise.resolve(n === 900 ? pull(900, { headSha: 'th' }) : pull(n)),
    mergeMethod: () => Promise.resolve('squash'),
    trainMerge: ((_db: unknown, input: { mergeMethod?: string }) => ((method = input.mergeMethod), d.calls.push('trainMerge'), Promise.resolve({ ok: true, result: { merged: true, alreadyMerged: false, sha: 'msha123456' } }))) as never,
  })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'merged')
  assertEquals(method, 'squash')
  assertEquals(d.calls, ['trainMerge', 'finalize', 'finalize', 'close 1', 'close 2'])
  assertEquals(tables.fix_merge_queue.map((r) => r.state), ['merged', 'merged'])
})

test('the latest completed review decides who rides, not the first row found', async () => {
  const rows = [qrow('a', 1)]
  const { db, tables } = setup(rows, {
    fix_reviews: [
      { fix_attempt_id: 'fa-a', verdict: 'hold', head_sha: 'old', status: 'completed', completed_at: '2026-10-22T00:00:00Z', created_at: '2026-10-22T00:00:00Z' },
      { fix_attempt_id: 'fa-a', verdict: 'merge', head_sha: 'h1', status: 'completed', completed_at: '2026-10-23T00:00:00Z', created_at: '2026-10-23T00:00:00Z' },
    ],
  })
  const d = deps()
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'started')
  assertEquals((tables.release_trains[0].members as Row[]).map((m) => m.prNumber), [1])
})

test('a PR that conflicts with main goes to a conflict agent instead of waiting for a train forever', async () => {
  const rows = [qrow('a', 1), qrow('b', 2)]
  const { db, tables } = setup(rows)
  const d = deps({ pull: (_t, _r, n) => Promise.resolve(n === 2 ? pull(2, { mergeable: false, mergeableState: 'dirty' }) : pull(n)) })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'started')
  assertEquals(tables.fix_merge_queue.map((r) => [r.id, r.state]), [['a', 'waiting'], ['b', 'resolving']])
  assertEquals((tables.release_trains[0].members as Row[]).map((m) => m.prNumber), [1])
})

test('past the conflict-agent cap a conflicting PR stays out of trains and is not sent again', async () => {
  const rows = [qrow('b', 2, { state: 'blocked', conflict_agents: 2 })]
  const { db, tables } = setup(rows)
  const d = deps({ pull: () => Promise.resolve(pull(2, { mergeable: false, mergeableState: 'dirty' })) })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(tables.fix_merge_queue[0].state, 'blocked')
  assertEquals(d.calls, [])
  assertEquals(out === 'started', false)
})

test('a train whose failing checks also fail on main is not bisected: nobody is held', async () => {
  const rows = [1, 2].map((n) => qrow(String.fromCharCode(96 + n), n, { state: 'waiting', train_id: 'tr1' }))
  const { db, tables } = setup(rows, { release_trains: [activeTrain([1, 2])] })
  const d = deps({
    pull: (_t, _r, n) => Promise.resolve(n === 900 ? pull(900, { headSha: 'th' }) : pull(n)),
    branchSha: () => Promise.resolve('mainhead'),
    checks: (_t, _r, sha) => Promise.resolve({ pending: 0, failed: sha === 'mainhead' ? ['Compare SDK to npm latest'] : ['Compare SDK to npm latest'] }),
  })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'base_red')
  assertEquals(tables.fix_merge_queue.map((r) => r.state), ['queued', 'queued'])
  assertEquals(tables.release_trains.length, 1)
})


// ADR 0044 amendment 2026-10-26: only a PR whose own head CI is green rides.

test('a PR red on its own head stays out of the train and is sent to CI repair; the green ones ride', async () => {
  const rows = [qrow('a', 1), qrow('b', 2), qrow('c', 3)]
  const { db, tables } = setup(rows)
  const d = deps({ checks: (_t, _r, sha) => Promise.resolve(sha === 'h2' ? { pending: 0, failed: ['Lint & Build', 'gate'], ran: ['Lint & Build', 'gate'] } : { pending: 0, failed: [], ran: ['Lint & Build', 'gate'] }) })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'started')
  assertEquals((tables.release_trains[0].members as Row[]).map((m) => m.prNumber), [1, 3])
  const b = tables.fix_merge_queue.find((r) => r.id === 'b')!
  assertEquals([b.state, String(b.detail).startsWith('CI fails on its own commit ("Lint & Build", "gate"). With review follow-ups on')], ['blocked', true])
})

test('when both follow-up rounds are used, a red PR says a person must fix it', async () => {
  const rows = [qrow('a', 1)]
  const { db, tables } = setup(rows, { fix_review_followups: [{ fix_attempt_id: 'fa-a', cursor_agent_id: 'c1' }, { fix_attempt_id: 'fa-a', cursor_agent_id: 'c2' }] })
  const d = deps({ checks: (_t, _r, sha) => Promise.resolve(sha === 'h1' ? { pending: 0, failed: ['required'], ran: ['required'] } : { pending: 0, failed: [], ran: ['required'] }) })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'nothing_ready')
  assertEquals(String(tables.fix_merge_queue[0].detail).includes('both follow-up rounds are used'), true)
})

test('a PR whose only failures are red on main too (an aggregator skipped there) waits for main, unblamed', async () => {
  const rows = [qrow('a', 1)]
  const { db, tables } = setup(rows)
  const d = deps({
    branchSha: () => Promise.resolve('mainhead'),
    checks: (_t, _r, sha) => Promise.resolve(sha === 'mainhead'
      ? { pending: 0, failed: ['Checks (security)'], ran: ['Checks (security)'] }
      : { pending: 0, failed: ['gate', 'Checks (security)'], ran: ['gate', 'Checks (security)'] }),
  })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'nothing_ready')
  assertEquals([tables.fix_merge_queue[0].state, tables.fix_merge_queue[0].detail], ['queued', 'main is red too ("Checks (security)"); it rides a release train once main passes.'])
})

test('CI still running, or not started while main has checks, keeps a PR out of the train', async () => {
  const rows = [qrow('a', 1), qrow('b', 2)]
  const { db, tables } = setup(rows)
  const d = deps({
    branchSha: () => Promise.resolve('mainhead'),
    checks: (_t, _r, sha) => Promise.resolve(sha === 'h1' ? { pending: 2, failed: [], ran: [] } : sha === 'h2' ? { pending: 0, failed: [], ran: [] } : { pending: 0, failed: [], ran: ['build'] }),
  })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'nothing_ready')
  const running = 'CI is running on its latest commit; it rides a release train once CI is green.'
  assertEquals(tables.fix_merge_queue.map((r) => [r.state, r.detail]), [['queued', running], ['queued', running]])
})

test('an approved draft is marked ready, one per tick, and rides only after its CI is green', async () => {
  const rows = [qrow('a', 1), qrow('b', 2)]
  const { db, tables } = setup(rows)
  const d = deps({ pull: (_t, _r, n) => Promise.resolve(pull(n, { draft: true })) })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d)
  assertEquals(out, 'nothing_ready')
  assertEquals(d.calls, ['ready 1'])
  const [a, b] = tables.fix_merge_queue.map((r) => String(r.detail))
  assertEquals([a.startsWith('Marked ready for review so its CI runs'), b.startsWith('A draft runs no CI.')], [true, true])
})

test('a member that failed alone at its head is not put back into the next train; a new commit lets it ride', async () => {
  const failedAlone = { id: 'old', repo: 'o/r', state: 'failed', pr_number: 800, detail: 'Members failed CI: Lint & Build.', created_at: '2026-10-24T05:00:00Z', members: [{ rowId: 'a', headSha: 'h1' }] }
  const soon = { ...settings, intervalMinutes: 30 }
  const rows = [qrow('a', 1, { state: 'blocked' }), qrow('b', 2)]
  const { db, tables } = setup(rows, { release_trains: [failedAlone] })
  const out = await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings: soon }, deps())
  assertEquals(out, 'started')
  assertEquals((tables.release_trains[1].members as Row[]).map((m) => m.prNumber), [2])
  const a = tables.fix_merge_queue.find((r) => r.id === 'a')!
  assertEquals([a.state, String(a.detail).startsWith('It failed CI alone in release train #800 at this commit (Lint & Build)')], ['blocked', true])

  // A CI-repair agent pushed h1b and Opus approved it: it rides again.
  const again = setup([qrow('a', 1, { state: 'blocked' })], {
    release_trains: [{ ...failedAlone }],
    fix_reviews: [{ fix_attempt_id: 'fa-a', verdict: 'merge', head_sha: 'h1b', status: 'completed' }],
  })
  const d2 = deps({ pull: (_t, _r, n) => Promise.resolve(pull(n, { headSha: 'h1b' })) })
  assertEquals(await runTrainTick(again.db, { repo: 'o/r', projectId: 'p1', token: 't', rows: [qrow('a', 1, { state: 'blocked' })], settings: soon }, d2), 'started')
})

test('a member that keeps riding red trains at one head stops after five', async () => {
  const red = (i: number) => ({ id: `t${i}`, repo: 'o/r', state: 'failed', pr_number: 800 + i, detail: 'Members failed CI: e2e.', created_at: '2026-10-24T05:00:00Z', members: [{ rowId: 'a', headSha: 'h1' }, { rowId: `x${i}`, headSha: 'hx' }] })
  const soon = { ...settings, intervalMinutes: 30 }
  const rows = [qrow('a', 1)]
  const four = setup(rows, { release_trains: [1, 2, 3, 4].map(red) })
  assertEquals(await runTrainTick(four.db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings: soon }, deps()), 'started')
  const five = setup(rows, { release_trains: [1, 2, 3, 4, 5].map(red) })
  assertEquals(await runTrainTick(five.db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings: soon }, deps()), 'nothing_ready')
  assertEquals(String(five.tables.fix_merge_queue[0].detail), 'It rode 5 release trains that failed CI at this commit. It rides again after a new commit.')
})

test('a red train whose failures are main\'s own, behind an aggregator skipped on main, is not bisected', async () => {
  const rows = [1, 2].map((n) => qrow(String.fromCharCode(96 + n), n, { state: 'waiting', train_id: 'tr1' }))
  const { db, tables } = setup(rows, { release_trains: [activeTrain([1, 2])] })
  const d = deps({
    pull: (_t, _r, n) => Promise.resolve(n === 900 ? pull(900, { headSha: 'th' }) : pull(n)),
    branchSha: () => Promise.resolve('mainhead'),
    checks: (_t, _r, sha) => Promise.resolve(sha === 'mainhead'
      ? { pending: 0, failed: ['npm audit'], ran: ['npm audit'] }
      : { pending: 0, failed: ['gate', 'npm audit'], ran: ['gate', 'npm audit'] }),
  })
  assertEquals(await runTrainTick(db, { repo: 'o/r', projectId: 'p1', token: 't', rows, settings }, d), 'base_red')
  assertEquals(tables.fix_merge_queue.map((r) => r.state), ['queued', 'queued'])
})
