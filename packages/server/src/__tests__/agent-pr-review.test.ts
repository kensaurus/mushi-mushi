/**
 * FILE: agent-pr-review.test.ts
 * PURPOSE: The agent-pr-review worker (ADR 0030) against a recorded fake DB,
 *          with the model, GitHub and key resolution injected:
 *            - skipped (and why) with no Anthropic key, with only the platform
 *              key, with review turned off, over budget, for a merged PR;
 *            - the stored review shape: verdict, findings, reviewed head SHA,
 *              model, tokens, cost, the "reviewed" fix event (dedupe key per
 *              try) and the PR comment (a report link, no report text);
 *            - every write of a run is guarded on its claim token, and a run
 *              a re-queue superseded stores nothing;
 *            - a model error retries later (10 min × tries), a refusal fails
 *              for good, a run that dies three times fails with an event;
 *            - one review per project per tick;
 *            - backfill queues only open cloud-agent PRs with no review.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, findQueries, hasFilter, type FakeQuery, type FakeResult } from './__stubs__/fake-query-recorder.ts'

const mocks = vi.hoisted(() => ({
  recordLlmUsage: vi.fn(async () => ({ error: null })),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (_n: string, h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({ resolveLlmKey: async () => null }))
vi.mock('../../supabase/functions/_shared/claude-messages.ts', () => ({
  claudeGenerateObject: async () => {
    throw new Error('the real model must not be called in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/llm-usage.ts', () => ({
  recordLlmUsage: (...args: unknown[]) => mocks.recordLlmUsage(...(args as [])),
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
}))
vi.mock('../../supabase/functions/_shared/agent-adapters.ts', () => ({
  DISPATCHABLE_CLOUD_AGENTS: new Set(['cursor_cloud', 'github_cloud_agent']),
}))

import {
  pickFairBatch,
  REVIEW_MAX_TRIES,
  REVIEW_RETRY_BACKOFF_MS,
  runAgentPrReview,
  type ReviewDeps,
} from '../../supabase/functions/agent-pr-review/index.ts'
import { REVIEW_COMMENT_MARKER, type AgentPrReviewRaw } from '../../supabase/functions/_shared/fix-review.ts'
import { ClaudeRefusalError } from '../../supabase/functions/_shared/claude-request.ts'

const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const REPORT = '0f7f2b1a-1111-4222-8333-444455556666'
const ATTEMPT_ID = '11111111-2222-4333-8444-555555555555'
const NOW = new Date('2026-10-21T09:00:00Z')
const RUN = 'run-token-1'

const QUEUE_ROW = { id: 'rev-1', fix_attempt_id: ATTEMPT_ID, project_id: PROJECT, report_id: REPORT, attempts: 0, comment_id: null }
const ATTEMPT = {
  id: ATTEMPT_ID,
  project_id: PROJECT,
  report_id: REPORT,
  agent: 'cursor_cloud',
  status: 'completed',
  pr_url: 'https://github.com/acme/app/pull/194',
  pr_number: 194,
  pr_state: 'open',
  merged_at: null,
  branch: 'bugfix/MUSHI-x-cursor-cloud',
  branch_name: 'bugfix/MUSHI-x-cursor-cloud',
  repo_id: null,
  check_run_status: 'completed',
  check_run_conclusion: 'success',
}

const HOLD: AgentPrReviewRaw = {
  findings: [
    { severity: 'blocker', file: 'src/lesson/Resume.tsx', line: 40, issue: 'Deletes the resume-lesson flow.', suggested_fix: 'Keep ResumeBanner and fix only the level lookup.' },
    { severity: 'minor', file: '(general)', line: null, issue: 'No test for the level.', suggested_fix: 'Add one.' },
  ],
  removes_behavior: ['Resume where you left off'],
  scope_creep: true,
  needs_human_decision: null,
  fixes_report: true,
  risk: 'high',
  summary: 'The PR fixes the crash but deletes the resume-lesson feature and ignores the learner level.',
  verdict: 'fix_first',
}

interface Script {
  queue?: unknown[]
  attempt?: unknown
  settings?: unknown
  claim?: boolean
  /** The run lost its claim (a re-queue cleared run_id): guarded writes match nothing. */
  superseded?: boolean
  existingReviews?: unknown[]
  openAttempts?: unknown[]
  gaveUp?: unknown[]
}

function scripted(s: Script = {}) {
  return createFakeDb((q: FakeQuery): FakeResult => {
    if (q.table === 'fix_reviews') {
      const payload = (q.payload ?? {}) as { status?: string }
      if (q.op === 'update' && hasFilter(q, 'lt', 'started_at')) {
        return { data: payload.status === 'failed' ? (s.gaveUp ?? []) : [] }
      }
      if (q.op === 'update' && payload.status === 'running') return { data: s.claim === false ? [] : [{ id: 'rev-1' }] }
      if (q.op === 'update' && hasFilter(q, 'eq', 'run_id')) return { data: s.superseded ? [] : [{ id: 'rev-1' }] }
      if (q.op === 'update') return { data: [] }
      if (q.op === 'select' && q.columns === 'fix_attempt_id') return { data: s.existingReviews ?? [] }
      if (q.op === 'select') return { data: s.queue ?? [QUEUE_ROW] }
      return { data: null }
    }
    if (q.table === 'fix_attempts' && q.op === 'select') {
      if (hasFilter(q, 'in', 'agent')) {
        // Honour .range() like PostgREST, so backfill paging is exercised.
        const r = q.filters.find((f) => f.method === 'range')
        const all = s.openAttempts ?? []
        return { data: r ? all.slice(r.args[0] as number, (r.args[1] as number) + 1) : all }
      }
      return { data: 'attempt' in s ? s.attempt : ATTEMPT }
    }
    if (q.table === 'project_settings') return { data: 'settings' in s ? s.settings : { agent_pr_review_enabled: true } }
    if (q.table === 'reports') {
      return {
        data: {
          id: REPORT,
          summary: 'Lesson page crashes for new learners',
          description: 'Opening a lesson as a beginner shows an error.',
          category: 'bug',
          severity: 'high',
          component: 'Lesson',
          reproduction_steps: ['Sign up', 'Open lesson 1'],
          stage2_analysis: { rootCause: 'level is undefined for new accounts' },
        },
      }
    }
    return { data: null }
  })
}

function deps(over: Partial<ReviewDeps> = {}): ReviewDeps & { calls: { model: number; comment: string[]; ready: number[] } } {
  const calls = { model: 0, comment: [] as string[], ready: [] as number[] }
  return {
    calls,
    markReady: async (_t, _r, n) => {
      calls.ready.push(n)
      return { ok: true, alreadyReady: false }
    },
    now: () => NOW,
    newRunId: () => RUN,
    consoleBaseUrl: () => 'https://console.example',
    resolveAnthropicKey: async () => ({ key: 'sk-ant-test', source: 'byok', hint: 'test' }),
    resolveGithubToken: async () => 'gh-token',
    fetchPr: async () => ({
      number: 194,
      draft: false,
      state: 'open',
      merged: false,
      title: 'fix: lesson crash',
      body: 'Fixes the crash.',
      htmlUrl: ATTEMPT.pr_url,
      headRef: ATTEMPT.branch,
      headSha: 'abcdef1234567',
      baseRef: 'main',
      baseRepoId: 4242,
      baseRepoFullName: 'acme/app',
      mergeable: true,
      mergeableState: 'clean',
    }),
    fetchFiles: async () => ({
      files: [{ filename: 'src/lesson/Resume.tsx', status: 'modified', additions: 3, deletions: 40, patch: '@@ -1,40 +1,3 @@\n-export function ResumeBanner() {}' }],
      complete: true,
    }),
    callModel: async () => {
      calls.model++
      return { object: HOLD, usage: { promptTokens: 12_000, completionTokens: 6_000 }, response: { modelId: 'claude-opus-5-5' } }
    },
    upsertComment: async (_t, _r, _n, body) => {
      calls.comment.push(body)
      return { id: 987, url: 'https://github.com/acme/app/pull/194#issuecomment-987' }
    },
    ...over,
  }
}

function reviewUpdates(queries: FakeQuery[]) {
  return findQueries(queries, 'fix_reviews', 'update')
}
const payloads = (queries: FakeQuery[]) => reviewUpdates(queries).map((q) => q.payload as Record<string, unknown>)

beforeEach(() => mocks.recordLlmUsage.mockClear())

describe('skips, with the reason stored', () => {
  it('skips without an Anthropic key and never calls the model', async () => {
    const { db, queries } = scripted()
    const d = deps({ resolveAnthropicKey: async () => null })
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary).toMatchObject({ claimed: 1, skipped: 1, completed: 0 })
    expect(summary.results[0]).toMatchObject({ outcome: 'skipped', reason: 'no_anthropic_key' })
    expect(d.calls.model).toBe(0)
    const skip = reviewUpdates(queries).find((q) => (q.payload as { status?: string }).status === 'skipped')!
    expect(skip.payload).toMatchObject({ skip_reason: 'no_anthropic_key' })
    // A skip never touches the verdict columns (a previous hold stays).
    expect(skip.payload).not.toHaveProperty('verdict')
    expect(skip.filters).toEqual(expect.arrayContaining([{ method: 'eq', args: ['run_id', RUN] }, { method: 'eq', args: ['status', 'running'] }]))
    const ev = findQueries(queries, 'fix_events', 'insert')[0]?.payload as Record<string, unknown>
    expect(ev).toMatchObject({ kind: 'reviewed', status: 'pending', label: 'Opus review skipped' })
  })

  it('does not spend the platform key: an env key is "no Anthropic key" too', async () => {
    const { db } = scripted()
    const d = deps({ resolveAnthropicKey: async () => ({ key: 'sk-platform', source: 'env', hint: 'plat' }) })
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary.results[0]).toMatchObject({ outcome: 'skipped', reason: 'no_anthropic_key' })
    expect(d.calls.model).toBe(0)
  })

  it('skips quietly when the project turned review off', async () => {
    const { db, queries } = scripted({ settings: { agent_pr_review_enabled: false } })
    const summary = await runAgentPrReview(db, {}, deps())
    expect(summary.results[0]).toMatchObject({ outcome: 'skipped', reason: 'review_off' })
    expect(findQueries(queries, 'fix_events', 'insert')).toHaveLength(0)
  })

  it('skips when the budget is used up', async () => {
    const { db } = scripted()
    const budget = Object.assign(new Error('over budget'), { name: 'LlmBudgetExceededError' })
    const summary = await runAgentPrReview(db, {}, deps({ resolveAnthropicKey: async () => { throw budget } }))
    expect(summary.results[0]).toMatchObject({ outcome: 'skipped', reason: 'llm_budget_exceeded' })
  })

  it('skips a PR that merged in the meantime', async () => {
    const { db } = scripted({ attempt: { ...ATTEMPT, pr_state: 'merged', merged_at: '2026-10-21T08:00:00Z' } })
    const summary = await runAgentPrReview(db, {}, deps())
    expect(summary.results[0]).toMatchObject({ outcome: 'skipped', reason: 'pr_not_open' })
  })
})

describe('a completed review', () => {
  it('claims with a run token only when due, and stores the verdict, findings, reviewed head, model, tokens and cost', async () => {
    const { db, queries } = scripted()
    const d = deps()
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary).toMatchObject({ completed: 1, verdicts: { hold: 1, merge: 0, fix_first: 0 } })

    const claim = reviewUpdates(queries).find((q) => (q.payload as { status?: string }).status === 'running')!
    expect(claim.payload).toMatchObject({ run_id: RUN, attempts: 1 })
    expect(claim.filters).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['status', 'queued'] },
      { method: 'lte', args: ['queued_at', NOW.toISOString()] },
    ]))

    const done = reviewUpdates(queries).find((q) => (q.payload as { status?: string }).status === 'completed')!
    expect(done.filters).toEqual(expect.arrayContaining([{ method: 'eq', args: ['run_id', RUN] }, { method: 'eq', args: ['status', 'running'] }]))
    expect(done.payload).toMatchObject({
      verdict: 'hold', // a blocker raises the model's "fix first"
      fixes_report: true,
      risk: 'high',
      scope_creep: true,
      removes_behavior: ['Resume where you left off'],
      needs_human_decision: null,
      head_sha: 'abcdef1234567',
      reviewed_at: NOW.toISOString(),
      diff_truncated: false,
      ci_state: 'passed',
      model: 'claude-opus-5-5',
      input_tokens: 12_000,
      output_tokens: 6_000,
      // Opus 5.5: $4 in / $20 out per MTok → 0.048 + 0.12
      cost_usd: 0.168,
      pr_url: ATTEMPT.pr_url,
      repo: 'acme/app',
      // GitHub's repo id: the merge gate finds this review by it after a rename.
      repo_id: 4242,
      pr_number: 194,
      run_id: null,
      error: null,
    })
    const saved = done.payload as Record<string, unknown>
    expect((saved.findings as Array<{ severity: string }>).map((f) => f.severity)).toEqual(['blocker', 'minor'])
    expect(saved.rules_applied).toEqual(['A finding is a blocker.'])
    expect(saved.diff_stats).toMatchObject({ files: 1, shownFiles: 1, additions: 3, deletions: 40, sourceOmitted: [] })

    const ev = findQueries(queries, 'fix_events', 'insert')[0]?.payload as Record<string, unknown>
    expect(ev).toMatchObject({
      fix_attempt_id: ATTEMPT_ID,
      project_id: PROJECT,
      kind: 'reviewed',
      status: 'fail',
      label: 'Opus review: hold',
      dedupe_key: 'review:rev-1:abcdef1234567:1',
    })
    expect(ev.payload).toMatchObject({ verdict: 'hold', blockers: 1, model: 'claude-opus-5-5' })

    expect(d.calls.comment).toHaveLength(1)
    expect(d.calls.comment[0]).toContain('### Mushi review (claude-opus-5-5): hold')
    expect(d.calls.comment[0]).toContain('https://console.example/reports/' + REPORT)
    // The comment never quotes the report or the summary.
    expect(d.calls.comment[0]).not.toContain('Lesson page crashes')
    expect(d.calls.comment[0]).not.toContain(HOLD.summary)
    expect(d.calls.comment[0]).toContain(REVIEW_COMMENT_MARKER)
    expect(payloads(queries).some((u) => u.comment_id === 987)).toBe(true)
    expect(mocks.recordLlmUsage).toHaveBeenCalledTimes(1)
  })

  it('records the spend even when the run was superseded, and then stores nothing else', async () => {
    const { db, queries } = scripted({ superseded: true })
    const d = deps()
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary).toMatchObject({ superseded: 1, completed: 0 })
    expect(mocks.recordLlmUsage).toHaveBeenCalledTimes(1)
    expect(findQueries(queries, 'fix_events', 'insert')).toHaveLength(0)
    expect(d.calls.comment).toHaveLength(0)
  })

  it('holds when a source file could not be shown in full', async () => {
    const { db, queries } = scripted()
    const d = deps({
      callModel: async () => ({ object: { ...HOLD, findings: [], removes_behavior: [], scope_creep: false, risk: 'low', verdict: 'merge' }, usage: { promptTokens: 1, completionTokens: 1 } }),
      fetchFiles: async () => ({ files: [{ filename: 'src/server.ts', status: 'modified', additions: 900, deletions: 0, patch: null }], complete: true }),
    })
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary.results[0]).toMatchObject({ outcome: 'completed', verdict: 'hold' })
    const done = payloads(queries).find((u) => u.status === 'completed')!
    expect(done.rules_applied).toContain('A source file was too large to review in full.')
  })

  it('sends the report and the diff, and keeps the stored verdict when the comment fails', async () => {
    const { db, queries } = scripted()
    let prompt = ''
    const d = deps({
      callModel: async (input) => {
        prompt = input.prompt
        expect(input.model).toBe('claude-opus-5-5')
        return { object: { ...HOLD, findings: [], removes_behavior: [], scope_creep: false, risk: 'low', verdict: 'merge' }, usage: { promptTokens: 1, completionTokens: 1 } }
      },
      upsertComment: async () => {
        throw new Error('comment post 403')
      },
    })
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary.results[0]).toMatchObject({ outcome: 'completed', verdict: 'merge' })
    expect(prompt).toContain('Lesson page crashes for new learners')
    expect(prompt).toContain("Mushi's diagnosis of the likely cause:")
    expect(prompt).toContain('-export function ResumeBanner() {}')
    expect(payloads(queries).some((u) => u.status === 'completed')).toBe(true)
  })
})

describe('readying the PR so host CI runs (drafts skip CI)', () => {
  const MERGE = { ...HOLD, findings: [], removes_behavior: [], scope_creep: false, risk: 'low', verdict: 'merge' }

  it('marks a "merge" PR ready and records it on the timeline', async () => {
    const { db, queries } = scripted()
    const d = deps({ callModel: async () => ({ object: MERGE, usage: { promptTokens: 1, completionTokens: 1 } }) })
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary.results[0]).toMatchObject({ outcome: 'completed', verdict: 'merge' })
    expect(d.calls.ready).toEqual([194])
    const labels = findQueries(queries, 'fix_events', 'insert').map((q) => (q.payload as { label: string }).label)
    expect(labels).toContain('Marked ready for review (CI runs)')
  })

  it('leaves a "hold" PR a draft', async () => {
    const { db } = scripted()
    const d = deps()
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary.results[0]).toMatchObject({ outcome: 'completed', verdict: 'hold' })
    expect(d.calls.ready).toEqual([])
  })

  it('keeps the verdict when readying fails', async () => {
    const { db, queries } = scripted()
    const d = deps({
      callModel: async () => ({ object: MERGE, usage: { promptTokens: 1, completionTokens: 1 } }),
      markReady: async () => {
        throw new Error('GraphQL 403')
      },
    })
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary.results[0]).toMatchObject({ outcome: 'completed', verdict: 'merge' })
    expect(payloads(queries).some((u) => u.status === 'completed')).toBe(true)
  })
})

describe('failures, retries and races', () => {
  it('puts the review back in the queue after a model error, due 10 min × tries later', async () => {
    const { db, queries } = scripted()
    const summary = await runAgentPrReview(db, {}, deps({ callModel: async () => { throw new Error('529 overloaded') } }))
    expect(summary.results[0]).toMatchObject({ outcome: 'retry' })
    const retry = payloads(queries).find((u) => u.status === 'queued' && u.error === '529 overloaded')!
    expect(retry.queued_at).toBe(new Date(NOW.getTime() + REVIEW_RETRY_BACKOFF_MS).toISOString())
    expect(retry.run_id).toBeNull()
    expect(mocks.recordLlmUsage).toHaveBeenCalledTimes(1)
  })

  it('fails for good on the last try, and on a refusal, with an event per try', async () => {
    const last = scripted({ queue: [{ ...QUEUE_ROW, attempts: REVIEW_MAX_TRIES - 1 }] })
    const a = await runAgentPrReview(last.db, {}, deps({ callModel: async () => { throw new Error('timeout') } }))
    expect(a.results[0]).toMatchObject({ outcome: 'failed' })
    const ev = findQueries(last.queries, 'fix_events', 'insert')[0]?.payload as Record<string, unknown>
    expect(ev).toMatchObject({ label: 'Opus review failed', dedupe_key: `review-fail:rev-1:${REVIEW_MAX_TRIES}` })

    const refused = scripted()
    const b = await runAgentPrReview(refused.db, {}, deps({ callModel: async () => { throw new ClaudeRefusalError('claude-opus-5-5', 'cyber') } }))
    expect(b.results[0]).toMatchObject({ outcome: 'failed' })
    expect(payloads(refused.queries).some((u) => u.status === 'failed' && u.error === 'Claude declined to review this pull request.')).toBe(true)
  })

  it('leaves a row another tick already claimed', async () => {
    const { db } = scripted({ claim: false })
    const d = deps()
    const summary = await runAgentPrReview(db, {}, d)
    expect(summary).toMatchObject({ claimed: 0, completed: 0 })
    expect(d.calls.model).toBe(0)
  })

  it('re-queues runs stuck in running, and fails the ones out of tries with completed_at and an event', async () => {
    const { db, queries } = scripted({
      queue: [],
      gaveUp: [{ id: 'rev-9', fix_attempt_id: ATTEMPT_ID, project_id: PROJECT, attempts: 3 }],
    })
    const summary = await runAgentPrReview(db, {}, deps())
    expect(summary.gaveUp).toBe(1)
    const stale = reviewUpdates(queries).filter((q) => hasFilter(q, 'lt', 'started_at'))
    expect(stale.map((q) => (q.payload as { status: string }).status).sort()).toEqual(['failed', 'queued'])
    const failed = stale.find((q) => (q.payload as { status: string }).status === 'failed')!
    expect(failed.payload).toMatchObject({ completed_at: NOW.toISOString(), run_id: null })
    const ev = findQueries(queries, 'fix_events', 'insert')[0]?.payload as Record<string, unknown>
    expect(ev).toMatchObject({ fix_attempt_id: ATTEMPT_ID, label: 'Opus review failed', dedupe_key: 'review-fail:rev-9:3' })
  })
})

describe('fairness', () => {
  it('takes at most one review per project per tick, oldest first', () => {
    const rows = [
      { id: 'a1', project_id: 'A' },
      { id: 'a2', project_id: 'A' },
      { id: 'a3', project_id: 'A' },
      { id: 'b1', project_id: 'B' },
      { id: 'c1', project_id: 'C' },
      { id: 'd1', project_id: 'D' },
    ]
    expect(pickFairBatch(rows).map((r) => r.id)).toEqual(['a1', 'b1', 'c1'])
  })
})

describe('backfill', () => {
  it('queues only open cloud-agent PRs that have no review yet', async () => {
    const { db, queries } = scripted({
      queue: [],
      openAttempts: [
        { id: 'fa-a', project_id: PROJECT, report_id: REPORT, pr_url: 'https://github.com/acme/app/pull/1' },
        { id: 'fa-b', project_id: PROJECT, report_id: REPORT, pr_url: 'https://github.com/acme/app/pull/2' },
      ],
      existingReviews: [{ fix_attempt_id: 'fa-a' }],
    })
    const summary = await runAgentPrReview(db, { backfill: true, limit: 10 }, deps())
    expect(summary.enqueued).toBe(1)
    const read = findQueries(queries, 'fix_attempts', 'select').find((q) => hasFilter(q, 'in', 'agent'))!
    expect(read.filters).toEqual(
      expect.arrayContaining([
        { method: 'in', args: ['agent', ['cursor_cloud', 'github_cloud_agent']] },
        { method: 'in', args: ['pr_state', ['open', 'draft']] },
        { method: 'range', args: [0, 49] },
      ]),
    )
    const upserts = findQueries(queries, 'fix_reviews', 'upsert')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].payload).toMatchObject({ fix_attempt_id: 'fa-b', status: 'queued' })
  })

  it('pages past already-reviewed PRs to reach older unreviewed ones', async () => {
    // 60 open PRs, newest first; the newest 50 are reviewed, the older 10 are not.
    const openAttempts = Array.from({ length: 60 }, (_, i) => ({
      id: `fa-${i}`,
      project_id: PROJECT,
      report_id: REPORT,
      pr_url: `https://github.com/acme/app/pull/${1000 - i}`,
    }))
    const existingReviews = openAttempts.slice(0, 50).map((a) => ({ fix_attempt_id: a.id }))
    const { db, queries } = scripted({ queue: [], openAttempts, existingReviews })
    const summary = await runAgentPrReview(db, { backfill: true, limit: 5 }, deps())
    expect(summary.enqueued).toBe(5)
    const queuedIds = findQueries(queries, 'fix_reviews', 'upsert').map((q) => (q.payload as { fix_attempt_id: string }).fix_attempt_id)
    expect(queuedIds).toEqual(['fa-50', 'fa-51', 'fa-52', 'fa-53', 'fa-54'])
    const pages = findQueries(queries, 'fix_attempts', 'select').filter((q) => hasFilter(q, 'in', 'agent'))
    expect(pages).toHaveLength(2)
  })
})
