/**
 * FILE: release-batch.test.ts
 * PURPOSE: The release batch view (console ops plan 2026-10-27, P1): who
 *          rides is the merge queue's own rule (ADR 0044 and its 2026-10-26
 *          amendment: approved at the current commit, not a draft, own CI
 *          green, not benched, not urgent); an open train lists its members;
 *          migration files are matched against the recipe's folder or the
 *          common ones; the deploy after a merged train is matched by commit,
 *          then by time; nothing read is "none".
 */
import { describe, expect, it } from 'vitest'
import {
  buildRepoBatch,
  deployAfterMerge,
  DEPLOY_GAP_HREF,
  memberCi,
  migrationFilesOf,
  migrationGlobs,
  recipeMigrationsDir,
  trainMembers,
  type BatchAttempt,
  type BatchQueueRow,
  type BatchReview,
  type BatchTrainRow,
  type HeadCi,
  type MemberFiles,
  type RepoBatchInput,
} from '../../supabase/functions/_shared/release-batch.ts'
import { RED_TRAIN_DETAIL_PREFIX } from '../../supabase/functions/_shared/merge-train.ts'

const NOW = new Date('2026-10-27T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
const REPO = 'kensaurus/glot.it'

function attempt(id: string, over: Partial<BatchAttempt> = {}): BatchAttempt {
  return { id, prUrl: `https://github.com/${REPO}/pull/${id.slice(1)}`, prState: 'open', headSha: `${id}head0000`, checkRunConclusion: null, title: `Fix ${id}`, severity: 'medium', source: 'sdk', ...over }
}
function queued(id: string, pr: number, over: Partial<BatchQueueRow> = {}): BatchQueueRow {
  return { id: `row-${id}`, fix_attempt_id: id, repo: REPO, pr_number: pr, state: 'queued', detail: null, queued_at: hoursAgo(10 - pr / 100), train_id: null, ...over }
}
function review(id: string, verdict: string, head: string): BatchReview {
  return { fix_attempt_id: id, verdict, head_sha: head, status: 'completed', completed_at: hoursAgo(1), created_at: hoursAgo(1) }
}

function input(over: Partial<RepoBatchInput> = {}): RepoBatchInput {
  const a1 = attempt('a1')
  const a2 = attempt('a2')
  const a3 = attempt('a3', { prState: 'draft' })
  return {
    now: NOW,
    projectId: 'p1',
    projectName: 'glot.it',
    repo: REPO,
    settings: { mode: 'train', intervalMinutes: 360, maxMembers: 15 },
    trains: [],
    queue: [queued('a1', 101), queued('a2', 102), queued('a3', 103)],
    attempts: new Map([a1, a2, a3].map((a) => [a.id, a])),
    reviews: [review('a1', 'merge', a1.headSha!), review('a2', 'merge', 'olderhead00'), review('a3', 'merge', a3.headSha!)],
    ciByHead: new Map<string, HeadCi>([
      [a1.headSha!, { state: 'green', failing: [] }],
      [a2.headSha!, { state: 'green', failing: [] }],
    ]),
    migrationsDir: null,
    files: new Map<string, MemberFiles | null>([
      ['a1', { files: [{ filename: 'supabase/migrations/20261027_add_col.sql' }, { filename: 'src/a.ts' }], complete: true }],
      ['a2', { files: [{ filename: 'src/b.ts' }], complete: true }],
      ['a3', { files: [], complete: true }],
    ]),
    deploys: [],
    ...over,
  }
}

describe('buildRepoBatch: who rides the next train', () => {
  it('only an approved-at-head, non-draft, green member rides; the others say why', () => {
    const b = buildRepoBatch(input())
    expect(b.train.kind).toBe('next')
    expect(b.members.map((m) => [m.prNumber, m.rides])).toEqual([[101, true], [102, false], [103, false]])
    const byPr = new Map(b.members.map((m) => [m.prNumber, m]))
    expect(byPr.get(101)!.why).toBe('Ready: it rides the next train.')
    expect(byPr.get(102)!.why).toContain('Opus approved an older commit')
    expect(byPr.get(102)!.verdictAtHead).toBe(false)
    expect(byPr.get(103)!.why).toContain('A draft runs no CI')
    expect(b.gates.find((g) => g.id === 'approved_at_head')).toMatchObject({ passed: 2, total: 3 })
    expect(b.gates.find((g) => g.id === 'ci_green')).toMatchObject({ passed: 2, total: 3 })
    expect(b.train.readyCount).toBe(1)
  })

  it('leaves now when no train left yet; otherwise one interval after the last one', () => {
    expect(buildRepoBatch(input()).train.leavesAt).toBe(NOW.toISOString())
    const last: BatchTrainRow = { id: 't0', repo: REPO, pr_number: 50, state: 'merged', members: [], attempt: 1, detail: null, head_sha: null, merge_sha: 'm1', created_at: hoursAgo(2), merged_at: hoursAgo(1) }
    expect(buildRepoBatch(input({ trains: [last] })).train.leavesAt).toBe(new Date(Date.parse(hoursAgo(2)) + 360 * 60_000).toISOString())
  })

  it('a failing or base-failing CI, a hold and an urgent fix each wait with their reason', () => {
    const base = input()
    const a2 = base.attempts.get('a2')!
    const a4 = attempt('a4', { severity: 'critical' })
    const b = buildRepoBatch(
      input({
        queue: [...base.queue, queued('a4', 104)],
        attempts: new Map([...base.attempts, ['a4', a4]]),
        reviews: [review('a1', 'merge', 'a1head0000'), review('a2', 'merge', a2.headSha!), review('a3', 'hold', 'a3head0000'), review('a4', 'merge', a4.headSha!)],
        ciByHead: new Map<string, HeadCi>([
          ['a1head0000', { state: 'code_failure', failing: ['test', 'lint'] }],
          [a2.headSha!, { state: 'base_failing', failing: ['npm audit'] }],
          [a4.headSha!, { state: 'green', failing: [] }],
        ]),
      }),
    )
    const byPr = new Map(b.members.map((m) => [m.prNumber, m]))
    expect(byPr.get(101)!.why).toBe('CI is failing on its latest commit (test, lint).')
    expect(byPr.get(102)!.why).toContain('The base branch fails the same checks (npm audit)')
    expect(byPr.get(103)!.why).toContain('Opus said hold')
    expect(byPr.get(104)!).toMatchObject({ express: true, rides: false })
    expect(byPr.get(104)!.why).toContain('merges on its own')
    expect(b.members.every((m) => !m.rides)).toBe(true)
    expect(b.train.leavesAt).toBeNull()
  })

  it('a member that failed alone in a red train at this commit is benched until a new commit', () => {
    const red: BatchTrainRow = {
      id: 't1',
      repo: REPO,
      pr_number: 77,
      state: 'failed',
      members: [{ rowId: 'row-a1', fixAttemptId: 'a1', prNumber: 101, headSha: 'a1head0000' }],
      attempt: 4,
      detail: `${RED_TRAIN_DETAIL_PREFIX} test.`,
      head_sha: null,
      merge_sha: null,
      created_at: hoursAgo(3),
      merged_at: null,
    }
    const b = buildRepoBatch(input({ trains: [red] }))
    const m = b.members.find((x) => x.prNumber === 101)!
    expect(m.rides).toBe(false)
    expect(m.benched).toContain('It failed CI alone in release train #77')
    expect(b.gates.find((g) => g.id === 'not_benched')).toMatchObject({ passed: 2, total: 3 })
  })

  it('an open train lists its members as riding, with the train CI from its head', () => {
    const open: BatchTrainRow = {
      id: 't2',
      repo: REPO,
      pr_number: 88,
      state: 'testing',
      members: [{ rowId: 'row-a1', fixAttemptId: 'a1', prNumber: 101, headSha: 'a1head0000' }],
      attempt: 1,
      detail: 'CI is running for 1 fixes (2 checks left).',
      head_sha: 'trainhead00',
      merge_sha: null,
      created_at: hoursAgo(0.5),
      merged_at: null,
    }
    const base = input()
    const b = buildRepoBatch(input({ trains: [open], ciByHead: new Map([...base.ciByHead, ['trainhead00', { state: 'pending', failing: [] }]]) }))
    expect(b.train).toMatchObject({ kind: 'open', prNumber: 88, state: 'testing', ci: 'pending', leavesAt: null, readyCount: 1 })
    expect(b.members[0]).toMatchObject({ prNumber: 101, rides: true, why: 'Riding this train.' })
    expect(b.members.filter((m) => m.rides)).toHaveLength(1)
  })

  it('release mode "each": nothing rides, and it says the app does not use trains', () => {
    const b = buildRepoBatch(input({ settings: { mode: 'each', intervalMinutes: 360, maxMembers: 15 } }))
    expect(b.mode).toBe('each')
    expect(b.members.every((m) => !m.rides && m.why.includes('merges each fix on its own'))).toBe(true)
    expect(b.train.leavesAt).toBeNull()
  })
})

describe('migrations', () => {
  it('uses the recipe folder, else the common folders; a rename counts by either name', () => {
    expect(migrationGlobs('db/migrations/')).toEqual({ source: 'recipe', globs: ['db/migrations/**'] })
    expect(migrationGlobs(null).source).toBe('default')
    expect(migrationGlobs('../etc').source).toBe('default')
    expect(recipeMigrationsDir({ version: 1, data: { migrationsDir: 'db/migrations' } })).toBe('db/migrations')
    expect(recipeMigrationsDir({ data: 'x' })).toBeNull()
    expect(recipeMigrationsDir(null)).toBeNull()
    const globs = migrationGlobs(null).globs
    expect(migrationFilesOf([{ filename: 'supabase/migrations/1.sql' }, { filename: 'src/x.ts' }, { filename: 'db/new.sql', previousFilename: 'prisma/migrations/2/migration.sql' }], globs)).toEqual([
      'supabase/migrations/1.sql',
      'db/new.sql',
    ])
  })

  it('lists them per PR; an unread or cut-off list makes the set incomplete, never empty-and-done', () => {
    const b = buildRepoBatch(input())
    expect(b.migrations).toMatchObject({ source: 'default', files: [{ prNumber: 101, path: 'supabase/migrations/20261027_add_col.sql' }], complete: true, unread: [] })
    const files = new Map(input().files)
    files.set('a2', null)
    files.set('a3', { files: [], complete: false })
    const partial = buildRepoBatch(input({ files }))
    expect(partial.migrations).toMatchObject({ complete: false, unread: [102] })
    const recipe = buildRepoBatch(input({ migrationsDir: 'db/migrations' }))
    expect(recipe.migrations).toMatchObject({ source: 'recipe', files: [] })
  })
})

describe('memberCi', () => {
  it('reads stored jobs first, then the PR check summary; no data is "none", no head is "unknown"', () => {
    const ci = new Map<string, HeadCi>([['h1', { state: 'infra', failing: [] }]])
    expect(memberCi('h1', ci, 'failure').ci).toBe('machine')
    expect(memberCi('h2', ci, 'success').ci).toBe('green')
    expect(memberCi('h2', ci, 'failure').ci).toBe('failing')
    expect(memberCi('h2', ci, null).ci).toBe('none')
    expect(memberCi(null, ci, null).ci).toBe('unknown')
  })
})

describe('deployAfterMerge', () => {
  const merged: BatchTrainRow = { id: 't', repo: REPO, pr_number: 90, state: 'merged', members: [], attempt: 1, detail: null, head_sha: null, merge_sha: 'abcdef1234567', created_at: hoursAgo(5), merged_at: hoursAgo(4) }
  it('the merge commit seen running is live; a later deploy is matched by time (squash merges)', () => {
    expect(deployAfterMerge([merged], [{ observed_at: hoursAgo(3), observed_commit: 'abcdef1', observed_version: '1.2.3', ok: true }], NOW)).toMatchObject({ state: 'live', version: '1.2.3', setupGapHref: null })
    expect(deployAfterMerge([merged], [{ observed_at: hoursAgo(3), observed_commit: '9999999', observed_version: null, ok: true }], NOW).state).toBe('deployed_since_merge')
  })
  it('no deploy after the merge is "not seen"; none in 14 days links the setup gap', () => {
    const r = deployAfterMerge([merged], [{ observed_at: hoursAgo(6), observed_commit: 'x', observed_version: null, ok: true }], NOW)
    expect(r).toMatchObject({ state: 'not_seen', setupGapHref: null })
    expect(deployAfterMerge([merged], [], NOW)).toMatchObject({ state: 'not_seen', setupGapHref: DEPLOY_GAP_HREF })
    expect(deployAfterMerge([], [], NOW).state).toBe('no_merge')
  })
})

describe('trainMembers', () => {
  it('reads the stored member list and drops malformed entries', () => {
    expect(trainMembers([{ rowId: 'r', fixAttemptId: 'a', prNumber: 1, headSha: 'h' }, { fixAttemptId: 2 }, null])).toEqual([{ rowId: 'r', fixAttemptId: 'a', prNumber: 1, headSha: 'h' }])
    expect(trainMembers('nope')).toEqual([])
  })
})
