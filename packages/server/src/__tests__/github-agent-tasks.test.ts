/**
 * FILE: github-agent-tasks.test.ts
 * PURPOSE: Pin the GitHub Copilot Agent Tasks client (`_shared/
 *          github-agent-tasks.ts`) against docs.github.com/en/rest/agent-tasks:
 *          path, X-GitHub-Api-Version 2026-03-10, body keys, state mapping,
 *          actionable 401/403/404 errors, and PR / head_ref extraction.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  GITHUB_AGENT_TASKS_API_VERSION,
  GithubAgentTasksError,
  buildCreateTaskBody,
  createGithubAgentTask,
  extractGithubTaskError,
  extractGithubTaskHeadRef,
  extractGithubTaskPrUrl,
  getGithubAgentTask,
  mapGithubTaskState,
} from '../../supabase/functions/_shared/github-agent-tasks.ts'

function fetchMockReturning(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('buildCreateTaskBody', () => {
  it('uses the documented snake_case keys and defaults create_pull_request to true', () => {
    expect(buildCreateTaskBody({ owner: 'o', repo: 'r', prompt: 'fix', baseRef: 'main', model: 'claude-sonnet-4.6' })).toEqual({
      prompt: 'fix',
      create_pull_request: true,
      base_ref: 'main',
      model: 'claude-sonnet-4.6',
    })
    expect(buildCreateTaskBody({ owner: 'o', repo: 'r', prompt: 'fix' })).toEqual({ prompt: 'fix', create_pull_request: true })
  })
})

describe('createGithubAgentTask', () => {
  it('POSTs /agents/repos/{owner}/{repo}/tasks with the preview API version header', async () => {
    const fetchImpl = fetchMockReturning({ id: 'task_1', state: 'queued', html_url: 'https://github.com/o/r/agents/1' }, 201)
    const task = await createGithubAgentTask({ token: 'github_pat_x', fetchImpl }, { owner: 'o', repo: 'r', prompt: 'fix', baseRef: 'main' })
    expect(task.id).toBe('task_1')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/agents/repos/o/r/tasks')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['X-GitHub-Api-Version']).toBe(GITHUB_AGENT_TASKS_API_VERSION)
    expect(GITHUB_AGENT_TASKS_API_VERSION).toBe('2026-03-10')
    expect(headers.Accept).toBe('application/vnd.github+json')
    expect(headers.Authorization).toBe('Bearer github_pat_x')
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'fix', create_pull_request: true, base_ref: 'main' })
  })

  it.each([
    [401, /user-to-server token/i],
    [403, /"Agent tasks"/],
    [404, /not available|not visible/i],
    [422, /base_ref/],
  ])('surfaces an actionable message for HTTP %s', async (status, pattern) => {
    const fetchImpl = fetchMockReturning({ message: 'nope' }, status)
    const err = await createGithubAgentTask({ token: 't', fetchImpl }, { owner: 'o', repo: 'r', prompt: 'fix' }).catch((e) => e)
    expect(err).toBeInstanceOf(GithubAgentTasksError)
    expect((err as GithubAgentTasksError).status).toBe(status)
    expect((err as GithubAgentTasksError).message).toMatch(pattern)
    // "GitHub" + status in the message → fix-worker categorizeFailure github_4xx.
    expect((err as GithubAgentTasksError).message).toMatch(new RegExp(`GitHub Agent Tasks ${status}`))
  })
})

describe('getGithubAgentTask', () => {
  it('uses the repo-scoped path when owner/repo are known, else /agents/tasks/{id}', async () => {
    const fetchImpl = fetchMockReturning({ id: 'task_1', state: 'in_progress' })
    await getGithubAgentTask({ token: 't', fetchImpl }, { taskId: 'task_1', owner: 'o', repo: 'r' })
    await getGithubAgentTask({ token: 't', fetchImpl }, { taskId: 'task_1' })
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://api.github.com/agents/repos/o/r/tasks/task_1')
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe('https://api.github.com/agents/tasks/task_1')
  })
})

describe('state + artifact helpers', () => {
  it.each([
    ['queued', 'working'],
    ['in_progress', 'working'],
    ['idle', 'working'],
    ['waiting_for_user', 'working'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['timed_out', 'failed'],
    ['cancelled', 'cancelled'],
    [undefined, 'working'],
  ])('%s → %s', (input, expected) => {
    expect(mapGithubTaskState(input as string | undefined)).toBe(expected)
  })

  it('finds a PR URL in any of the artifact shapes and ignores non-PR links', () => {
    expect(
      extractGithubTaskPrUrl({
        artifacts: [
          { provider: 'github', type: 'commit', data: { url: 'https://github.com/o/r/commit/abc' } },
          { provider: 'github', type: 'pull_request', data: { html_url: 'https://github.com/o/r/pull/42' } },
        ],
      }),
    ).toBe('https://github.com/o/r/pull/42')
    expect(extractGithubTaskPrUrl({ artifacts: [{ data: { pull_request: { html_url: 'https://github.com/o/r/pull/7' } } }] })).toBe(
      'https://github.com/o/r/pull/7',
    )
    expect(extractGithubTaskPrUrl({ artifacts: [{ data: 'https://github.com/o/r/pull/8' }] })).toBe('https://github.com/o/r/pull/8')
    expect(extractGithubTaskPrUrl({ artifacts: [] })).toBeNull()
    expect(extractGithubTaskPrUrl(null)).toBeNull()
  })

  it('reads head_ref and error from sessions[]', () => {
    const task = { state: 'failed', sessions: [{ id: 's1', head_ref: 'copilot/fix-login', error: 'boom' }] }
    expect(extractGithubTaskHeadRef(task)).toBe('copilot/fix-login')
    expect(extractGithubTaskError(task)).toBe('boom')
    expect(extractGithubTaskHeadRef({ sessions: [] })).toBeNull()
  })
})
