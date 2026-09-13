/**
 * FILE: agent-adapters.test.ts
 * PURPOSE: Contract tests for `_shared/agent-adapters.ts` — the cloud
 *          coding-agent interface (cursor_cloud / github_cloud_agent /
 *          anthropic_managed stub), the dispatch allow-list that replaced
 *          fix-dispatch.ts's silent null, the shared prompt/branch
 *          conventions, and `applyCloudAgentOutcome`, the single completion
 *          path shared by cursor-webhook, agent-status-poll and the GitHub
 *          indexer (idempotent on pr_url IS NULL).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFakeDb, findQueries, eqValue, hasFilter } from './__stubs__/fake-query-recorder.ts'

const mocks = vi.hoisted(() => ({
  notifyTeamFixEvent: vi.fn(async () => undefined),
  dispatchPluginEventDetached: vi.fn(async () => undefined),
  resolveLlmKey: vi.fn(async (): Promise<unknown> => null),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: (...args: unknown[]) => mocks.resolveLlmKey(...(args as [])),
}))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  parseGithubRepoUrl: (url: string | null | undefined) => {
    const m = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(url ?? '')
    return m ? { owner: m[1], repo: m[2] } : null
  },
}))
vi.mock('../../supabase/functions/_shared/github-pr.ts', () => ({
  generateCursorCloudBranchName: (reportId: string, category?: string | null) =>
    `${category === 'other' ? 'chore' : 'bugfix'}/MUSHI-${reportId}-cursor-cloud`,
  validateFixBranchName: () => undefined,
}))
vi.mock('../../supabase/functions/_shared/team-notify.ts', () => ({
  notifyTeamFixEvent: (...args: unknown[]) => mocks.notifyTeamFixEvent(...(args as [])),
}))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({
  dispatchPluginEventDetached: (...args: unknown[]) => mocks.dispatchPluginEventDetached(...(args as [])),
}))

import {
  ALLOWED_AGENT_OVERRIDES,
  applyCloudAgentOutcome,
  buildCloudAgentPrompt,
  cloudAgentBranchName,
  getCloudAgentAdapter,
  isDispatchableCloudAgent,
  parseCloudAgentBranchRef,
  pollResultToOutcome,
  resolveCursorApiKey,
  validateAgentOverride,
} from '../../supabase/functions/_shared/agent-adapters.ts'
import { deterministicCursorAgentId } from '../../supabase/functions/_shared/cursor-cloud.ts'

const REPORT = '0f7f2b1a-1111-4222-8333-444455556666'
const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const TARGET = { attemptId: 'fa-1', projectId: PROJECT, reportId: REPORT, agent: 'cursor_cloud' }

beforeEach(() => {
  mocks.notifyTeamFixEvent.mockClear()
  mocks.dispatchPluginEventDetached.mockClear()
  mocks.resolveLlmKey.mockReset()
  mocks.resolveLlmKey.mockResolvedValue(null)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('validateAgentOverride (fix-dispatch allow-list)', () => {
  it('accepts the cloud agents and keeps auto as "project default"', () => {
    expect(validateAgentOverride('cursor_cloud')).toEqual({ ok: true, agent: 'cursor_cloud' })
    expect(validateAgentOverride('github_cloud_agent')).toEqual({ ok: true, agent: 'github_cloud_agent' })
    expect(validateAgentOverride('auto')).toEqual({ ok: true, agent: 'auto' })
    expect(validateAgentOverride(undefined)).toEqual({ ok: true, agent: null })
    expect(validateAgentOverride(null)).toEqual({ ok: true, agent: null })
    expect(validateAgentOverride('')).toEqual({ ok: true, agent: null })
  })

  it('rejects unknown agents with a 400-shaped UNSUPPORTED_AGENT instead of silently nulling', () => {
    const res = validateAgentOverride('copilot_magic')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('UNSUPPORTED_AGENT')
      expect(res.message).toContain('copilot_magic')
      expect(res.message).toContain('cursor_cloud')
    }
    expect(validateAgentOverride(42).ok).toBe(false)
  })

  it('fix-dispatch.ts routes through the shared validator and answers 400 UNSUPPORTED_AGENT', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/fix-dispatch.ts'), 'utf-8')
    expect(src).toContain('validateAgentOverride(')
    expect(src).toContain("code: agentValidation.code")
    expect(src).not.toMatch(/const ALLOWED_AGENTS = \[/)
    expect(ALLOWED_AGENT_OVERRIDES).toContain('cursor_cloud')
    expect(ALLOWED_AGENT_OVERRIDES).toContain('github_cloud_agent')
  })

  it('fix-worker SUPPORTED_AGENTS lists both cloud agents and branches to dispatchToCloudAgent', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/fix-worker/index.ts'), 'utf-8')
    const block = src.slice(src.indexOf('const SUPPORTED_AGENTS = new Set('), src.indexOf(']);', src.indexOf('const SUPPORTED_AGENTS')))
    expect(block).toContain("'cursor_cloud'")
    expect(block).toContain("'github_cloud_agent'")
    expect(src).toContain('isDispatchableCloudAgent(requestedAgent)')
    expect(src).toContain("'fix.requested'")
    expect(isDispatchableCloudAgent('cursor_cloud')).toBe(true)
    expect(isDispatchableCloudAgent('anthropic_managed')).toBe(false)
  })
})

describe('prompt + branch conventions', () => {
  it('buildCloudAgentPrompt appends the draft-PR / branch / base-ref instructions', () => {
    const prompt = buildCloudAgentPrompt('## Bug Report\nx', {
      reportId: REPORT,
      repoOwner: 'o',
      repoName: 'r',
      baseRef: 'develop',
      branchName: `bugfix/MUSHI-${REPORT}-cursor-cloud`,
      kind: 'cursor_cloud',
    })
    expect(prompt.startsWith('## Bug Report')).toBe(true)
    expect(prompt).toContain('as a DRAFT')
    expect(prompt).toContain(`bugfix/MUSHI-${REPORT}-cursor-cloud`)
    expect(prompt).toContain('`develop`')
    expect(prompt).toContain(`MUSHI-${REPORT}`)
    expect(prompt).toContain('Never merge')
  })

  it('cloudAgentBranchName keeps the Cursor helper prefix and swaps the suffix per backend', () => {
    expect(cloudAgentBranchName('cursor_cloud', REPORT, 'bug')).toBe(`bugfix/MUSHI-${REPORT}-cursor-cloud`)
    expect(cloudAgentBranchName('github_cloud_agent', REPORT, 'other')).toBe(`chore/MUSHI-${REPORT}-github-agent`)
  })

  it('parseCloudAgentBranchRef recovers report id + kind from a head ref (indexer fallback)', () => {
    expect(parseCloudAgentBranchRef(`bugfix/MUSHI-${REPORT}-cursor-cloud`)).toEqual({ reportId: REPORT, kind: 'cursor_cloud' })
    expect(parseCloudAgentBranchRef(`chore/MUSHI-${REPORT.toUpperCase()}-github-agent`)).toEqual({
      reportId: REPORT,
      kind: 'github_cloud_agent',
    })
    expect(parseCloudAgentBranchRef('copilot/fix-login-crash')).toBeNull()
    expect(parseCloudAgentBranchRef(null)).toBeNull()
  })
})

describe('pollResultToOutcome', () => {
  it('maps vendor poll results onto outcomes', () => {
    expect(pollResultToOutcome({ status: 'working' })).toBeNull()
    expect(pollResultToOutcome({ status: 'completed', prUrl: 'https://github.com/o/r/pull/1', branch: 'b' })).toEqual({
      kind: 'pr_opened',
      prUrl: 'https://github.com/o/r/pull/1',
      branch: 'b',
      summary: null,
    })
    expect(pollResultToOutcome({ status: 'completed' })).toEqual({ kind: 'completed_no_pr', summary: null })
    expect(pollResultToOutcome({ status: 'failed', error: 'x' })).toEqual({ kind: 'failed', error: 'x' })
    expect(pollResultToOutcome({ status: 'cancelled' })).toMatchObject({ kind: 'failed' })
  })
})

describe('applyCloudAgentOutcome', () => {
  it('pr_opened: writes pr_url guarded on pr_url IS NULL, mirrors the report, closes the job, notifies once', async () => {
    const { db, queries } = createFakeDb((q) => {
      if (q.table === 'fix_attempts' && q.op === 'update') return { data: [{ id: 'fa-1' }] }
      return { data: null }
    })
    const res = await applyCloudAgentOutcome(db, TARGET, {
      kind: 'pr_opened',
      prUrl: 'https://github.com/o/r/pull/12',
      branch: 'bugfix/MUSHI-x-cursor-cloud',
      summary: 'Fixed the null guard',
    })
    expect(res).toEqual({ applied: true })

    const attemptUpdate = findQueries(queries, 'fix_attempts', 'update')[0]
    expect(attemptUpdate.payload).toMatchObject({
      status: 'completed',
      pr_url: 'https://github.com/o/r/pull/12',
      pr_state: 'open',
      branch: 'bugfix/MUSHI-x-cursor-cloud',
      branch_name: 'bugfix/MUSHI-x-cursor-cloud',
    })
    expect(eqValue(attemptUpdate, 'id')).toBe('fa-1')
    expect(attemptUpdate.filters).toContainEqual({ method: 'is', args: ['pr_url', null] })

    const jobUpdate = findQueries(queries, 'fix_dispatch_jobs', 'update')[0]
    expect(jobUpdate.payload).toMatchObject({ status: 'completed', pr_url: 'https://github.com/o/r/pull/12' })
    expect(eqValue(jobUpdate, 'fix_attempt_id')).toBe('fa-1')

    const reportUpdate = findQueries(queries, 'reports', 'update')[0]
    expect(reportUpdate.payload).toMatchObject({
      fix_pr_url: 'https://github.com/o/r/pull/12',
      fix_branch: 'bugfix/MUSHI-x-cursor-cloud',
      status: 'fixing',
      processing_error: null,
    })
    expect(eqValue(reportUpdate, 'id')).toBe(REPORT)

    const fixEvent = findQueries(queries, 'fix_events', 'insert')[0]
    expect(fixEvent.payload).toMatchObject({ kind: 'pr_opened', dedupe_key: 'cloud-pr:fa-1' })

    expect(mocks.notifyTeamFixEvent).toHaveBeenCalledTimes(1)
    expect(mocks.notifyTeamFixEvent).toHaveBeenCalledWith(
      db,
      PROJECT,
      REPORT,
      'fix_pr_opened',
      expect.objectContaining({ prUrl: 'https://github.com/o/r/pull/12' }),
    )
    expect(mocks.dispatchPluginEventDetached).toHaveBeenCalledWith(
      db,
      PROJECT,
      'fix.proposed',
      expect.objectContaining({ fix: expect.objectContaining({ id: 'fa-1', prUrl: 'https://github.com/o/r/pull/12' }) }),
    )
  })

  it('pr_opened is idempotent: a second writer sees zero updated rows and does not notify', async () => {
    const { db, queries } = createFakeDb((q) => {
      if (q.table === 'fix_attempts' && q.op === 'update') return { data: [] }
      return { data: null }
    })
    const res = await applyCloudAgentOutcome(db, TARGET, { kind: 'pr_opened', prUrl: 'https://github.com/o/r/pull/12' })
    expect(res).toEqual({ applied: false, reason: 'already_has_pr' })
    expect(findQueries(queries, 'fix_dispatch_jobs', 'update')).toHaveLength(0)
    expect(findQueries(queries, 'reports', 'update')).toHaveLength(0)
    expect(mocks.notifyTeamFixEvent).not.toHaveBeenCalled()
  })

  it('pr_opened skips (and logs) when uq_fix_attempts_pr_url says another attempt owns the PR', async () => {
    const { db } = createFakeDb((q) => {
      if (q.table === 'fix_attempts' && q.op === 'update') {
        return { error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_fix_attempts_pr_url"' } }
      }
      return { data: null }
    })
    const res = await applyCloudAgentOutcome(db, TARGET, { kind: 'pr_opened', prUrl: 'https://github.com/o/r/pull/12' })
    expect(res).toEqual({ applied: false, reason: 'pr_url_conflict' })
    expect(mocks.notifyTeamFixEvent).not.toHaveBeenCalled()
  })

  it('failed: closes attempt + job, stamps the report, notifies fix_failed + plugin fix.failed', async () => {
    const { db, queries } = createFakeDb((q) => {
      if (q.table === 'fix_attempts' && q.op === 'update') return { data: [{ id: 'fa-1' }] }
      return { data: null }
    })
    const res = await applyCloudAgentOutcome(db, TARGET, { kind: 'failed', error: 'Cursor run ERROR' })
    expect(res).toEqual({ applied: true })
    const attemptUpdate = findQueries(queries, 'fix_attempts', 'update')[0]
    expect(attemptUpdate.payload).toMatchObject({ status: 'failed', error: 'Cursor run ERROR', failure_category: 'cursor_api_error' })
    expect(hasFilter(attemptUpdate, 'in', 'status')).toBe(true)
    expect(findQueries(queries, 'fix_dispatch_jobs', 'update')[0].payload).toMatchObject({ status: 'failed' })
    expect(findQueries(queries, 'reports', 'update')[0].payload).toMatchObject({
      processing_error: expect.stringContaining('autofix_blocked: Cursor run ERROR'),
    })
    expect(mocks.notifyTeamFixEvent).toHaveBeenCalledWith(db, PROJECT, REPORT, 'fix_failed', expect.objectContaining({ error: 'Cursor run ERROR' }))
    expect(mocks.dispatchPluginEventDetached).toHaveBeenCalledWith(db, PROJECT, 'fix.failed', expect.anything())
  })

  it('completed_no_pr: job goes to completed_no_pr and the github agent gets a github_* category', async () => {
    const { db, queries } = createFakeDb((q) => {
      if (q.table === 'fix_attempts' && q.op === 'update') return { data: [{ id: 'fa-1' }] }
      return { data: null }
    })
    const res = await applyCloudAgentOutcome(db, { ...TARGET, agent: 'github_cloud_agent' }, { kind: 'completed_no_pr' })
    expect(res).toEqual({ applied: true })
    expect(findQueries(queries, 'fix_attempts', 'update')[0].payload).toMatchObject({ failure_category: 'github_other_error' })
    expect(findQueries(queries, 'fix_dispatch_jobs', 'update')[0].payload).toMatchObject({ status: 'completed_no_pr' })
  })

  it('failed on an attempt that is no longer open is a no-op', async () => {
    const { db } = createFakeDb((q) => (q.table === 'fix_attempts' && q.op === 'update' ? { data: [] } : { data: null }))
    const res = await applyCloudAgentOutcome(db, TARGET, { kind: 'failed', error: 'late' })
    expect(res).toEqual({ applied: false, reason: 'not_open' })
    expect(mocks.notifyTeamFixEvent).not.toHaveBeenCalled()
  })
})

describe('resolveCursorApiKey', () => {
  it('prefers the BYOK pool, then project_settings.cursor_api_key_ref, then the env key', async () => {
    mocks.resolveLlmKey.mockResolvedValue({ key: 'crsr_pool', source: 'byok', hint: 'pool' })
    const { db } = createFakeDb(() => ({ data: null }))
    expect(await resolveCursorApiKey(db, PROJECT)).toBe('crsr_pool')

    mocks.resolveLlmKey.mockResolvedValue({ key: 'crsr_env', source: 'env', hint: 'env' })
    const { db: db2 } = createFakeDb((q) => {
      if (q.table === 'project_settings') return { data: { cursor_api_key_ref: 'vault://sec-cursor' } }
      if (q.op === 'rpc' && q.table === 'vault_get_secret') return { data: 'crsr_project' }
      return { data: null }
    })
    expect(await resolveCursorApiKey(db2, PROJECT)).toBe('crsr_project')

    const { db: db3 } = createFakeDb(() => ({ data: null }))
    expect(await resolveCursorApiKey(db3, PROJECT)).toBe('crsr_env')
  })
})

describe('cursor_cloud adapter', () => {
  it('dispatch POSTs /v1/agents with a deterministic bc- agentId and returns agent/run ids', async () => {
    mocks.resolveLlmKey.mockResolvedValue({ key: 'crsr_pool', source: 'byok', hint: 'pool' })
    const expectedAgentId = await deterministicCursorAgentId('dispatch-1')
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.cursor.com/v1/agents')
      return new Response(
        JSON.stringify({
          agent: { id: expectedAgentId, status: 'ACTIVE', url: 'https://cursor.com/agents/1' },
          run: { id: 'run_1', agentId: expectedAgentId, status: 'CREATING', git: { branches: [] } },
        }),
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const { db } = createFakeDb(() => ({ data: null }))
    const adapter = getCloudAgentAdapter('cursor_cloud')
    const res = await adapter.dispatch({
      db,
      projectId: PROJECT,
      reportId: REPORT,
      dispatchId: 'dispatch-1',
      attemptId: 'fa-1',
      repoUrl: 'https://github.com/o/r',
      baseRef: 'main',
      prompt: 'fix it',
      branchName: `bugfix/MUSHI-${REPORT}-cursor-cloud`,
    })
    expect(res).toMatchObject({ externalAgentId: expectedAgentId, externalRunId: 'run_1', statusUrl: 'https://cursor.com/agents/1' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.agentId).toBe(expectedAgentId)
    expect(body.autoCreatePR).toBe(true)
    expect(body.repos).toEqual([{ url: 'https://github.com/o/r', startingRef: 'main' }])
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer crsr_pool')
  })

  it('dispatch recovers the existing agent on 409 agent_id_conflict (retry-safe)', async () => {
    mocks.resolveLlmKey.mockResolvedValue({ key: 'crsr_pool', source: 'byok', hint: 'pool' })
    const expectedAgentId = await deterministicCursorAgentId('dispatch-1')
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ error: { code: 'agent_id_conflict', message: 'exists' } }), { status: 409 })
      }
      expect(url).toBe(`https://api.cursor.com/v1/agents/${expectedAgentId}`)
      return new Response(JSON.stringify({ id: expectedAgentId, latestRunId: 'run_existing', url: 'https://cursor.com/agents/1' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { db } = createFakeDb(() => ({ data: null }))
    const res = await getCloudAgentAdapter('cursor_cloud').dispatch({
      db,
      projectId: PROJECT,
      reportId: REPORT,
      dispatchId: 'dispatch-1',
      attemptId: 'fa-1',
      repoUrl: 'https://github.com/o/r',
      baseRef: 'main',
      prompt: 'fix it',
    })
    expect(res).toMatchObject({ externalAgentId: expectedAgentId, externalRunId: 'run_existing', ref: { reused: true } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('dispatch fails with an actionable error when no Cursor key is configured', async () => {
    const { db } = createFakeDb(() => ({ data: null }))
    await expect(
      getCloudAgentAdapter('cursor_cloud').dispatch({
        db,
        projectId: PROJECT,
        reportId: REPORT,
        dispatchId: 'd',
        attemptId: 'fa',
        repoUrl: 'https://github.com/o/r',
        baseRef: 'main',
        prompt: 'p',
      }),
    ).rejects.toThrow(/Cursor API key not configured/)
  })

  it('poll maps FINISHED + prUrl to completed and learns the run id for v0 agents', async () => {
    mocks.resolveLlmKey.mockResolvedValue({ key: 'crsr_pool', source: 'byok', hint: 'pool' })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/runs/run_9')) {
        return new Response(
          JSON.stringify({
            id: 'run_9',
            agentId: 'bc-1',
            status: 'FINISHED',
            result: 'done',
            git: { branches: [{ repoUrl: 'github.com/o/r', branch: 'b', prUrl: 'https://github.com/o/r/pull/3' }] },
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ id: 'bc-1', latestRunId: 'run_9' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { db } = createFakeDb(() => ({ data: null }))
    const res = await getCloudAgentAdapter('cursor_cloud').poll({
      db,
      projectId: PROJECT,
      attempt: { id: 'fa-1', project_id: PROJECT, report_id: REPORT, agent: 'cursor_cloud', status: 'running', pr_url: null, cursor_agent_id: 'bc-1', cursor_run_id: null },
    })
    expect(res).toMatchObject({ status: 'completed', prUrl: 'https://github.com/o/r/pull/3', branch: 'b', summary: 'done', ref: { cursor_run_id: 'run_9' } })
  })
})

describe('github_cloud_agent adapter', () => {
  it('dispatch resolves the user token from the vault ref and POSTs the Agent Tasks endpoint', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.github.com/agents/repos/o/r/tasks')
      expect((init?.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe('2026-03-10')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer github_pat_user')
      return new Response(JSON.stringify({ id: 'task_1', state: 'queued', html_url: 'https://github.com/o/r/agents/1' }), { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { db } = createFakeDb((q) => {
      if (q.table === 'project_settings') return { data: { github_user_token_ref: 'vault://sec-gh-user' } }
      if (q.op === 'rpc' && q.table === 'vault_get_secret') return { data: 'github_pat_user' }
      return { data: null }
    })
    const res = await getCloudAgentAdapter('github_cloud_agent').dispatch({
      db,
      projectId: PROJECT,
      reportId: REPORT,
      dispatchId: 'd-1',
      attemptId: 'fa-1',
      repoUrl: 'https://github.com/o/r',
      baseRef: 'main',
      prompt: 'fix it',
    })
    expect(res).toMatchObject({ externalAgentId: 'task_1', statusUrl: 'https://github.com/o/r/agents/1', ref: { owner: 'o', repo: 'r' } })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>
    expect(body).toEqual({ prompt: 'fix it', create_pull_request: true, base_ref: 'main' })
  })

  it('dispatch fails with the installation-token warning when no user token exists', async () => {
    const { db } = createFakeDb(() => ({ data: null }))
    await expect(
      getCloudAgentAdapter('github_cloud_agent').dispatch({
        db,
        projectId: PROJECT,
        reportId: REPORT,
        dispatchId: 'd-1',
        attemptId: 'fa-1',
        repoUrl: 'https://github.com/o/r',
        baseRef: 'main',
        prompt: 'fix it',
      }),
    ).rejects.toThrow(/user-to-server token/)
  })

  it('poll reads head_ref + PR artifact from the task', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'task_1',
          state: 'completed',
          artifacts: [{ provider: 'github', type: 'pull_request', data: { html_url: 'https://github.com/o/r/pull/5' } }],
          sessions: [{ id: 's', head_ref: 'copilot/fix-it' }],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { db } = createFakeDb((q) => {
      if (q.table === 'project_settings') return { data: { github_user_token_ref: 'github_pat_raw' } }
      return { data: null }
    })
    const res = await getCloudAgentAdapter('github_cloud_agent').poll({
      db,
      projectId: PROJECT,
      attempt: {
        id: 'fa-1',
        project_id: PROJECT,
        report_id: REPORT,
        agent: 'github_cloud_agent',
        status: 'running',
        pr_url: null,
        github_task_id: 'task_1',
        external_agent_ref: { owner: 'o', repo: 'r' },
      },
    })
    expect(res).toMatchObject({ status: 'completed', prUrl: 'https://github.com/o/r/pull/5', branch: 'copilot/fix-it' })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.github.com/agents/repos/o/r/tasks/task_1')
  })
})

describe('anthropic_managed adapter (interface only)', () => {
  it('throws not_implemented on dispatch and poll', async () => {
    const { db } = createFakeDb(() => ({ data: null }))
    const adapter = getCloudAgentAdapter('anthropic_managed')
    await expect(
      adapter.dispatch({ db, projectId: PROJECT, reportId: REPORT, dispatchId: 'd', attemptId: 'a', repoUrl: 'https://github.com/o/r', baseRef: 'main', prompt: 'p' }),
    ).rejects.toThrow(/not_implemented/)
    await expect(
      adapter.poll({ db, projectId: PROJECT, attempt: { id: 'a', project_id: PROJECT, report_id: REPORT, agent: 'anthropic_managed', status: 'running', pr_url: null } }),
    ).rejects.toMatchObject({ code: 'not_implemented' })
    expect(() => getCloudAgentAdapter('nope')).toThrow(/Unknown cloud agent kind/)
  })
})
