/**
 * FILE: fix-verifier.test.ts
 * PURPOSE: The fix-verifier worker (ADR 0035, Plan 024) against an in-memory
 *          DB, with GitHub, the second judge and the merge injected:
 *            - which fixes are due (a review of the head, no row yet or a
 *              stale open one; final rows and moved heads are skipped);
 *            - the gates are stored per head under a run_id claim, and a
 *              row another live run holds is left alone;
 *            - the second review runs only after the other five gates pass,
 *              only on the project's own key (never the platform key), and
 *              not late in a run;
 *            - automatic merge: only when on, under the daily cap, through
 *              gated-merge as a service caller pinned to the verified head;
 *            - the regression watch: signals, regressed_at, and a revert PR
 *              only when no later commit touched the fix's files.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const mocks = vi.hoisted(() => ({
  resolveLlmKey: vi.fn(),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (_n: string, h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({ resolveLlmKey: (...a: unknown[]) => mocks.resolveLlmKey(...a) }))
vi.mock('../../supabase/functions/_shared/llm-usage.ts', () => ({
  recordLlmUsage: async () => ({ error: null }),
  extractLlmUsage: (r: { usage?: { promptTokens?: number; completionTokens?: number } }) => ({
    inputTokens: r?.usage?.promptTokens ?? null,
    outputTokens: r?.usage?.completionTokens ?? null,
  }),
  servedModel: (r: { response?: { modelId?: string } }, fallback: string) => r?.response?.modelId ?? fallback,
}))
vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({
  startCronRun: async () => ({ finish: async () => undefined, fail: async () => undefined }),
}))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  fetchPullRequestDetails: async () => {
    throw new Error('inject fetchPr')
  },
  fetchPullRequestFiles: async () => {
    throw new Error('inject fetchFiles')
  },
  installationIdForAttempt: async () => null,
  resolveProjectGithubToken: async () => null,
  markPullRequestReady: async () => ({ ok: true, alreadyReady: true }),
}))
vi.mock('../../supabase/functions/_shared/agent-adapters.ts', () => ({
  DISPATCHABLE_CLOUD_AGENTS: new Set(['cursor_cloud', 'github_cloud_agent']),
}))
vi.mock('../../supabase/functions/_shared/fix-merge.ts', () => ({
  finalizeFixMerge: async () => {
    throw new Error('inject finalize')
  },
}))
vi.mock('../../supabase/functions/_shared/gated-merge.ts', () => ({
  gatedMergePullRequest: async () => {
    throw new Error('inject merge')
  },
}))

type Worker = typeof import('../../supabase/functions/fix-verifier/index.ts')
let worker: Worker
beforeAll(async () => {
  // The worker serves only under Deno; a stub serve keeps the import inert.
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined }, serve: () => undefined }
  worker = await import('../../supabase/functions/fix-verifier/index.ts')
})

const P = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const FIX = '11111111-2222-4333-8444-555555555555'
const REPORT = '0f7f2b1a-1111-4222-8333-444455556666'
const HEAD = 'a'.repeat(40)
const NOW = new Date('2026-10-21T12:00:00Z')
const PR_URL = 'https://github.com/acme/app/pull/194'

function attempt(over: Row = {}): Row {
  return {
    id: FIX,
    project_id: P,
    report_id: REPORT,
    agent: 'cursor_cloud',
    status: 'completed',
    pr_url: PR_URL,
    pr_number: 194,
    pr_state: 'open',
    merged_at: null,
    commit_sha: HEAD,
    branch: 'cursor/fix-cart',
    repo_id: null,
    ci_infra: null,
    summary: 'Cart total is NaN',
    created_at: '2026-10-21T10:00:00Z',
    regressed_at: null,
    ...over,
  }
}

function review(over: Row = {}): Row {
  return { id: 'rev-1', fix_attempt_id: FIX, status: 'completed', verdict: 'merge', head_sha: HEAD, reviewed_at: '2026-10-21T11:00:00Z', skip_reason: null, error: null, ...over }
}

const verifyCheck = {
  id: 7,
  name: 'Mushi verify',
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-10-21T11:30:00Z',
  output: {
    text: JSON.stringify({ schema: 1, head_sha: HEAD, base_sha: 'b'.repeat(40), tests: ['src/cart.test.ts'], head: 'pass', base: 'fail', verdict: 'fail_to_pass', command: 'pnpm vitest run {files}', runner: 'alienware-glot-1', duration_s: 30, log_tail: '' }),
  },
}
const greenCi = { name: 'build', status: 'completed', conclusion: 'success', started_at: '2026-10-21T11:20:00Z', completed_at: '2026-10-21T11:25:00Z' }
const FILES = [
  { filename: 'src/cart.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@\n-return a\n+return a ?? 0', previousFilename: null },
  { filename: 'src/cart.test.ts', status: 'added', additions: 1, deletions: 0, patch: '@@\n+  expect(total(null)).toBe(0)', previousFilename: null },
]

const JUDGE_MERGE = {
  object: { findings: [], removes_behavior: [], scope_creep: false, needs_human_decision: null, fixes_report: true, risk: 'low', summary: 'Looks right.', verdict: 'merge' },
  usage: { promptTokens: 1000, completionTokens: 200 },
  response: { modelId: 'gpt-5.4' },
}

let db: FakeDb
function seed(tables: Record<string, Row[]> = {}) {
  db = makeFakeDb(
    {
      fix_attempts: [attempt()],
      fix_reviews: [review()],
      fix_merge_gates: [],
      fix_regressions: [],
      fix_events: [],
      project_settings: [{ project_id: P, verified_auto_merge: true }],
      reports: [{ id: REPORT, project_id: P, status: 'fixing', summary: 'Cart total is NaN', description: 'x' }],
      ...tables,
    },
    {
      autoId: true,
      uniques: { fix_merge_gates: ['fix_attempt_id', 'head_sha'], fix_regressions: ['fix_attempt_id', 'signal'], fix_events: ['dedupe_key'] },
    },
  )
}

function deps(over: Record<string, unknown> = {}) {
  const calls = {
    judge: vi.fn(async () => JUDGE_MERGE),
    merge: vi.fn(async () => ({ ok: true, result: { merged: true, alreadyMerged: false, sha: 'mergesha' }, gate: {}, audit: {} })),
    finalize: vi.fn(async () => ({ justMerged: true, reportStatus: 'fixed' })),
    openRevert: vi.fn(async () => ({ url: 'https://github.com/acme/app/pull/200', number: 200, branch: 'mushi/revert-mergesh' })),
    compare: vi.fn(async () => ({ status: 'ahead', totalCommits: 1, commitsListed: 1, files: [{ filename: 'README.md' }] })),
  }
  const d = {
    now: () => NOW,
    elapsedMs: () => 0,
    newRunId: () => 'run-1',
    resolveGithubToken: async () => 'gh-token',
    fetchPr: async () => ({ number: 194, draft: false, state: 'open', merged: false, headSha: HEAD, htmlUrl: PR_URL, headRef: 'cursor/fix-cart', baseRef: 'main', title: 'Fix cart', body: 'b', mergeable: true, mergeableState: 'clean', baseRepoId: 1, baseRepoFullName: 'acme/app' }),
    fetchFiles: async () => ({ files: FILES, complete: true }),
    listChecks: async () => [greenCi, verifyCheck],
    workflowInstalled: async () => true,
    resolveJudgeKey: async () => ({ key: { key: 'sk-test', source: 'byok', hint: 'test' }, provider: 'openai', model: 'gpt-5.4' }),
    callJudge: calls.judge,
    merge: calls.merge,
    finalize: calls.finalize,
    compare: calls.compare,
    defaultBranch: async () => 'main',
    openRevert: calls.openRevert,
    ...over,
  }
  return { d: d as never, calls }
}

beforeEach(() => {
  mocks.resolveLlmKey.mockReset()
  seed()
})

const gatesOf = (row: Row) => (row.gates as Array<{ id: string; status: string }>).map((g) => `${g.id}:${g.status}`)

describe('a fix whose every gate passes', () => {
  it('is verified and merged on proof through gated-merge as a service caller, pinned to the head', async () => {
    const { d, calls } = deps()
    const summary = await worker.runFixVerifier(db as never, {}, d)
    expect(summary).toMatchObject({ checked: 1, passed: 1, merged: 1, judged: 1 })
    const row = db.table('fix_merge_gates')[0]
    expect(gatesOf(row)).toEqual(['review:pass', 'ci:pass', 'fail_to_pass:pass', 'protected:pass', 'budget:pass', 'second_review:pass'])
    expect(row).toMatchObject({ head_sha: HEAD, passed: true, auto_merge_state: 'merged', merge_sha: 'mergesha', run_id: null, repo: 'acme/app', pr_number: 194 })
    expect(row.merged_at).toBe(NOW.toISOString())
    expect(row.second_judge).toMatchObject({ provider: 'openai', model: 'gpt-5.4', verdict: 'merge', input_tokens: 1000 })

    expect(calls.merge).toHaveBeenCalledTimes(1)
    expect(calls.merge.mock.calls[0][1]).toMatchObject({
      caller: 'service',
      reason: 'verified_auto_merge',
      expectedHeadSha: HEAD,
      override: false,
      fixAttemptId: FIX,
      merge: { mergeMethod: 'squash' },
    })
    expect(calls.finalize.mock.calls[0][2]).toMatchObject({ source: 'verified_auto_merge', prNumber: 194 })
    expect(db.table('fix_events').map((e) => e.kind)).toEqual(['verified', 'auto_merged'])
  })

  it('is left for a person when automatic merge is off (the default)', async () => {
    seed({ project_settings: [] })
    const { d, calls } = deps()
    await worker.runFixVerifier(db as never, {}, d)
    expect(calls.merge).not.toHaveBeenCalled()
    expect(db.table('fix_merge_gates')[0]).toMatchObject({ passed: true, auto_merge_state: 'skipped' })
  })

  it('stops at the daily cap', async () => {
    seed({
      project_settings: [{ project_id: P, verified_auto_merge: true, verified_auto_merge_daily_limit: 1 }],
      fix_merge_gates: [{ id: 'old', fix_attempt_id: 'other', project_id: P, head_sha: 'c'.repeat(40), gates: [], passed: true, auto_merge_state: 'merged', merged_at: '2026-10-21T01:00:00.000Z', merge_sha: 'x' }],
    })
    const { d, calls } = deps()
    await worker.runFixVerifier(db as never, {}, d)
    expect(calls.merge).not.toHaveBeenCalled()
    const row = db.table('fix_merge_gates').find((r) => r.fix_attempt_id === FIX)!
    expect(row).toMatchObject({ auto_merge_state: 'skipped' })
    expect(String(row.auto_merge_detail)).toMatch(/limit of 1 automatic merge/)
  })

  it('records a refused merge as failed', async () => {
    const { d } = deps({ merge: async () => ({ ok: false, status: 409, code: 'REVIEW_HOLD', message: 'The Opus review of this pull request says hold.', review: null }) })
    await worker.runFixVerifier(db as never, {}, d)
    expect(db.table('fix_merge_gates')[0]).toMatchObject({ auto_merge_state: 'failed', auto_merge_detail: 'The Opus review of this pull request says hold.' })
  })
})

describe('the second review', () => {
  it('does not run while another gate is open', async () => {
    const { d, calls } = deps({ listChecks: async () => [greenCi], workflowInstalled: async () => false })
    await worker.runFixVerifier(db as never, {}, d)
    expect(calls.judge).not.toHaveBeenCalled()
    expect(gatesOf(db.table('fix_merge_gates')[0])).toEqual(['review:pass', 'ci:pass', 'fail_to_pass:not_set_up', 'protected:pass', 'budget:pass', 'second_review:pending'])
  })

  it('is unavailable without a key of the project\'s own, and never uses the platform key', async () => {
    mocks.resolveLlmKey.mockResolvedValue({ key: 'platform', source: 'env', hint: 'tfrm' })
    const { d, calls } = deps({ resolveJudgeKey: undefined })
    await worker.runFixVerifier(db as never, {}, d)
    expect(calls.judge).not.toHaveBeenCalled()
    expect(calls.merge).not.toHaveBeenCalled()
    const row = db.table('fix_merge_gates')[0]
    expect(gatesOf(row).at(-1)).toBe('second_review:unavailable')
    expect(row.passed).toBe(false)
    // auto: the OpenAI pool, OpenRouter keys included, through the resolver.
    expect(mocks.resolveLlmKey).toHaveBeenCalledWith(expect.anything(), P, 'openai', expect.objectContaining({ openAiOnly: false }))
  })

  it('uses the project\'s OpenRouter key with the vendor-prefixed default model', async () => {
    mocks.resolveLlmKey.mockResolvedValue({ key: 'sk-or', source: 'byok', hint: 'x-or', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' })
    const { d, calls } = deps({ resolveJudgeKey: undefined })
    await worker.runFixVerifier(db as never, {}, d)
    expect(calls.judge).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5.4' }))
    expect(db.table('fix_merge_gates')[0].second_judge).toMatchObject({ provider: 'openrouter' })
  })

  it('is unavailable when turned off, without resolving a key', async () => {
    seed({ project_settings: [{ project_id: P, verified_auto_merge: true, verify_second_judge: 'off' }] })
    const resolveJudgeKey = vi.fn()
    const { d, calls } = deps({ resolveJudgeKey })
    await worker.runFixVerifier(db as never, {}, d)
    expect(resolveJudgeKey).not.toHaveBeenCalled()
    expect(calls.judge).not.toHaveBeenCalled()
    expect(gatesOf(db.table('fix_merge_gates')[0]).at(-1)).toBe('second_review:unavailable')
  })

  it('a "hold" from the second family vetoes the merge', async () => {
    const { d, calls } = deps({ callJudge: async () => ({ ...JUDGE_MERGE, object: { ...JUDGE_MERGE.object, verdict: 'hold', fixes_report: false } }) })
    await worker.runFixVerifier(db as never, {}, d)
    expect(calls.merge).not.toHaveBeenCalled()
    expect(gatesOf(db.table('fix_merge_gates')[0]).at(-1)).toBe('second_review:fail')
  })

  it('does not start late in a run', async () => {
    const { d, calls } = deps({ elapsedMs: () => 45_000 })
    await worker.runFixVerifier(db as never, {}, d)
    expect(calls.judge).not.toHaveBeenCalled()
    expect(gatesOf(db.table('fix_merge_gates')[0]).at(-1)).toBe('second_review:pending')
  })

  it('keeps a failed call as a retry with a try count', async () => {
    const { d } = deps({ callJudge: async () => { throw new Error('timeout') } })
    await worker.runFixVerifier(db as never, {}, d)
    const row = db.table('fix_merge_gates')[0]
    expect(row.second_judge).toMatchObject({ verdict: null, error: 'timeout', tries: 1 })
    expect(gatesOf(row).at(-1)).toBe('second_review:pending')
  })
})

describe('which fixes are due', () => {
  it('skips a review about another commit than the PR head', async () => {
    seed({ fix_reviews: [review({ head_sha: 'f'.repeat(40) })] })
    const { d } = deps()
    expect((await worker.runFixVerifier(db as never, {}, d)).candidates).toBe(0)
  })

  it('skips a settled head, re-checks an open one after 10 minutes', async () => {
    const failed = [{ id: 'review', status: 'pass' }, { id: 'budget', status: 'fail' }]
    seed({ fix_merge_gates: [{ id: 'g', fix_attempt_id: FIX, project_id: P, head_sha: HEAD, gates: failed, passed: false, auto_merge_state: 'none', evaluated_at: '2026-10-21T10:00:00.000Z' }] })
    const { d } = deps()
    expect((await worker.runFixVerifier(db as never, {}, d)).candidates).toBe(0)

    const pending = [{ id: 'ci', status: 'pending' }]
    seed({ fix_merge_gates: [{ id: 'g', fix_attempt_id: FIX, project_id: P, head_sha: HEAD, gates: pending, passed: false, auto_merge_state: 'none', evaluated_at: '2026-10-21T11:55:00.000Z' }] })
    expect((await worker.runFixVerifier(db as never, {}, d)).candidates).toBe(0)
    seed({ fix_merge_gates: [{ id: 'g', fix_attempt_id: FIX, project_id: P, head_sha: HEAD, gates: pending, passed: false, auto_merge_state: 'none', evaluated_at: '2026-10-21T11:40:00.000Z', run_id: null }] })
    expect((await worker.runFixVerifier(db as never, {}, d)).checked).toBe(1)
  })

  it('a forced re-check runs a settled head again', async () => {
    seed({ fix_merge_gates: [{ id: 'g', fix_attempt_id: FIX, project_id: P, head_sha: HEAD, gates: [{ id: 'budget', status: 'fail' }], passed: false, auto_merge_state: 'none', evaluated_at: '2026-10-21T11:59:00.000Z' }] })
    const { d } = deps()
    expect((await worker.runFixVerifier(db as never, { fixAttemptId: FIX, force: true }, d)).checked).toBe(1)
  })

  it('leaves a row another live run holds', async () => {
    seed({ fix_merge_gates: [{ id: 'g', fix_attempt_id: FIX, project_id: P, head_sha: HEAD, gates: [], passed: false, auto_merge_state: 'none', evaluated_at: '2026-10-21T11:00:00.000Z', run_id: 'other-run', claimed_at: '2026-10-21T11:58:00.000Z' }] })
    const { d, calls } = deps()
    const summary = await worker.runFixVerifier(db as never, { fixAttemptId: FIX, force: true }, d)
    expect(summary.results[0]).toMatchObject({ outcome: 'not_claimed', reason: 'busy' })
    expect(calls.judge).not.toHaveBeenCalled()
    expect(db.table('fix_merge_gates')[0].run_id).toBe('other-run')
  })

  it('ignores PRs that are not a cloud agent\'s', async () => {
    seed({ fix_attempts: [attempt({ agent: 'claude_code' })] })
    const { d } = deps()
    expect((await worker.runFixVerifier(db as never, {}, d)).candidates).toBe(0)
  })
})

describe('the regression watch', () => {
  const MERGED_AT = '2026-10-21T10:00:00.000Z'
  function merged(tables: Record<string, Row[]> = {}) {
    seed({
      fix_attempts: [attempt({ pr_state: 'merged', merged_at: MERGED_AT })],
      fix_merge_gates: [{ id: 'g', fix_attempt_id: FIX, project_id: P, head_sha: HEAD, gates: [], passed: true, auto_merge_state: 'merged', merged_at: MERGED_AT, merge_sha: 'mergesha' }],
      project_settings: [{ project_id: P, verified_auto_merge: true }],
      ...tables,
    })
  }
  const redOnMerge = async (_t: string, _r: unknown, sha: string) =>
    sha === 'mergesha' ? [{ name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-10-21T10:05:00Z' }] : []

  it('CI failing on the merge commit marks the fix regressed and opens a revert PR when safe', async () => {
    merged()
    const { d, calls } = deps({ listChecks: redOnMerge })
    const summary = await worker.runFixVerifier(db as never, {}, d)
    expect(summary).toMatchObject({ watched: 1, regressions: 1, revertsOpened: 1 })
    expect(db.table('fix_regressions')).toEqual([
      expect.objectContaining({ signal: 'ci_failed_on_merge', merge_sha: 'mergesha', revert_state: 'pr_opened', revert_pr_url: 'https://github.com/acme/app/pull/200' }),
    ])
    expect(db.table('fix_attempts')[0].regressed_at).toBe(NOW.toISOString())
    expect(calls.compare).toHaveBeenCalledWith('gh-token', { owner: 'acme', repo: 'app' }, 'mergesha', 'main')
    expect(calls.openRevert.mock.calls[0][0]).toMatchObject({ mergeSha: 'mergesha', defaultBranch: 'main', paths: ['src/cart.ts', 'src/cart.test.ts'], signal: 'ci_failed_on_merge' })
    expect(db.table('fix_events').map((e) => e.kind)).toEqual(['regressed', 'revert_opened'])
  })

  it('a later commit touching the same file gives not_safe, and no revert PR', async () => {
    merged()
    const { d, calls } = deps({ listChecks: redOnMerge, compare: async () => ({ status: 'ahead', totalCommits: 1, commitsListed: 1, files: [{ filename: 'src/cart.ts' }] }) })
    await worker.runFixVerifier(db as never, {}, d)
    expect(calls.openRevert).not.toHaveBeenCalled()
    expect(db.table('fix_regressions')[0]).toMatchObject({ signal: 'ci_failed_on_merge', revert_state: 'not_safe' })
    // The reason sits beside the signal's own evidence, which stays.
    expect(db.table('fix_regressions')[0].evidence).toMatchObject({ revert: expect.stringMatching(/Later commits changed src\/cart\.ts/), worst: { name: 'test', kind: 'code_failure' } })
    expect(db.table('fix_attempts')[0].regressed_at).toBe(NOW.toISOString())
  })

  it('with auto_revert off only flags the fix', async () => {
    merged({ project_settings: [{ project_id: P, auto_revert: 'off' }] })
    const { d, calls } = deps({ listChecks: redOnMerge })
    await worker.runFixVerifier(db as never, {}, d)
    expect(calls.openRevert).not.toHaveBeenCalled()
    expect(db.table('fix_regressions')[0]).toMatchObject({ revert_state: 'off' })
  })

  it('a reopened report regresses the fix; a new report in a changed file only flags it', async () => {
    merged({
      reports: [
        { id: REPORT, project_id: P, status: 'reopened', reopened_at: '2026-10-21T11:00:00.000Z', created_at: '2026-10-20T00:00:00.000Z' },
        { id: 'r-new', project_id: P, status: 'new', created_at: '2026-10-21T11:30:00.000Z', custom_metadata: { sentryFrames: ['src/cart.ts'] }, console_logs: null },
      ],
    })
    const { d } = deps()
    await worker.runFixVerifier(db as never, {}, d)
    const bySignal = Object.fromEntries(db.table('fix_regressions').map((r) => [r.signal, r]))
    expect(bySignal.report_reopened).toMatchObject({ revert_state: 'pr_opened' })
    expect(bySignal.new_report_in_changed_file).toMatchObject({ revert_state: 'none' })
    expect(bySignal.new_report_in_changed_file.evidence).toMatchObject({ reports: [{ reportId: 'r-new', files: ['src/cart.ts'] }] })
  })

  it('records each signal once, and stops watching after 72 hours', async () => {
    merged()
    const { d, calls } = deps({ listChecks: redOnMerge })
    await worker.runFixVerifier(db as never, {}, d)
    await worker.runFixVerifier(db as never, {}, d)
    expect(db.table('fix_regressions')).toHaveLength(1)
    expect(calls.openRevert).toHaveBeenCalledTimes(1)

    merged({ fix_merge_gates: [{ id: 'g', fix_attempt_id: FIX, project_id: P, head_sha: HEAD, gates: [], passed: true, auto_merge_state: 'merged', merged_at: '2026-10-18T10:00:00.000Z', merge_sha: 'mergesha' }] })
    expect((await worker.runFixVerifier(db as never, {}, deps({ listChecks: redOnMerge }).d)).watched).toBe(0)
  })
})
