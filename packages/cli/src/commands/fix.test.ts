import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli, TEST_CONFIG, TEST_PROJECT_ID } from '../test-harness.js'
import { registerFixCommands } from './fix.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return { ...actual, loadConfig: () => ({ ...TEST_CONFIG }) }
})

const REPORT = '44444444-5555-4666-8777-888888888888'
const FRONTEND = '33333333-aaaa-4bbb-8ccc-000000000001'
const BACKEND = '33333333-aaaa-4bbb-8ccc-000000000002'
const LINKED = [
  { id: FRONTEND, repo_url: 'https://github.com/acme/solo-boss-cloud' },
  { id: BACKEND, repo_url: 'git@github.com:Acme/solo-boss-cloud_backend.git' },
]

const dispatchReply = okReply({ dispatchId: 'd-1', status: 'queued' })

describe('mushi fix --repo', () => {
  it('sends a repo id as targetRepoId', async () => {
    const run = await runCli(registerFixCommands, ['fix', REPORT, '--repo', BACKEND], () => dispatchReply)
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/admin/fixes/dispatch',
      body: { reportId: REPORT, projectId: TEST_PROJECT_ID, targetRepoId: BACKEND },
    })
  })

  it('resolves owner/name through the linked repos, ignoring case and .git', async () => {
    const run = await runCli(registerFixCommands, ['fix', REPORT, '--repo', 'acme/solo-boss-cloud_backend'], (call) =>
      call.path.startsWith('/v1/admin/repo/repos') ? okReply(LINKED) : dispatchReply,
    )
    expect(run.calls[0]!.path).toBe(`/v1/admin/repo/repos?project_id=${TEST_PROJECT_ID}`)
    expect(run.calls[1]).toMatchObject({ path: '/v1/admin/fixes/dispatch', body: { targetRepoId: BACKEND } })
  })

  it('refuses a name that is not linked, listing the linked ones, and dispatches nothing', async () => {
    const run = await runCli(registerFixCommands, ['fix', REPORT, '--repo', 'acme/elsewhere'], () => okReply(LINKED))
    expect(run.calls).toHaveLength(1)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
    expect(run.error?.message).toContain('acme/elsewhere is not linked')
  })

  it('rejects a malformed repo id before calling the API', async () => {
    const run = await runCli(registerFixCommands, ['fix', REPORT, '--repo', 'backend'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })

  it('--wait polls the dispatch job the route returned', async () => {
    let polls = 0
    const run = await runCli(registerFixCommands, ['fix', REPORT, '--wait'], (call) => {
      if (call.method === 'POST') return dispatchReply
      polls++
      expect(call.path).toBe('/v1/admin/fixes/dispatch/d-1')
      return okReply({ status: 'completed', pr_url: 'https://github.com/acme/app/pull/7' })
    })
    expect(polls).toBe(1)
    expect(run.error).toBeNull()
    expect(run.exitCode).toBe(0)
  }, 20_000)

  it('sends no targetRepoId without --repo', async () => {
    const run = await runCli(registerFixCommands, ['fix', REPORT], () => dispatchReply)
    expect(run.calls[0]!.body).toEqual({ reportId: REPORT, projectId: TEST_PROJECT_ID, agent: 'claude_code' })
  })
})

const FIX = '55555555-6666-4777-8888-999999999999'
const VERIFICATION = {
  headSha: 'abcdef1234567890',
  passed: false,
  gates: [
    { id: 'review', status: 'pass', label: 'Opus review: merge', detail: '' },
    { id: 'ci', status: 'pass', label: 'CI green', detail: '' },
    { id: 'fail_to_pass', status: 'not_set_up', label: 'Test proves the fix', detail: 'Add the mushi-verify workflow: mushi verify workflow.' },
    { id: 'protected', status: 'fail', label: 'No tests weakened', detail: 'src/a.test.ts removes 2 assertions.' },
    { id: 'budget', status: 'pass', label: 'Small change (2 files, 48 lines)', detail: '' },
    { id: 'second_review', status: 'pending', label: 'Second review', detail: 'Runs after the other gates pass.' },
  ],
  autoMerge: { state: 'none', detail: null },
  regressions: [
    { signal: 'report_reopened', detail: null, revert_state: 'pr_opened', revert_pr_url: 'https://github.com/acme/app/pull/9' },
    { signal: 'ci_failed_on_merge', detail: 'test job failed', revertState: 'not_safe', revertPrUrl: null },
  ],
}

describe('mushi fixes verify', () => {
  it('reads the verification and prints each gate as glyph, word, label and what to do', async () => {
    const run = await runCli(registerFixCommands, ['fixes', 'verify', FIX], () => okReply(VERIFICATION))
    expect(run.calls).toEqual([expect.objectContaining({ method: 'GET', path: `/v1/admin/fixes/${FIX}/verification` })])
    expect(run.stdout).toContain('Head abcdef1: not verified yet')
    expect(run.stdout).toMatch(/✓ pass\s+Opus review: merge/)
    expect(run.stdout).toMatch(/○ not set up\s+Test proves the fix\n\s+Add the mushi-verify workflow/)
    expect(run.stdout).toMatch(/✗ fail\s+No tests weakened\n\s+src\/a.test.ts removes 2 assertions./)
    expect(run.stdout).toMatch(/… pending\s+Second review/)
    expect(run.stdout).toContain('Automatic merge: not merged by Mushi')
    expect(run.stdout).toContain('Regression: the report was reopened')
    expect(run.stdout).toContain('Revert PR: https://github.com/acme/app/pull/9')
    expect(run.stdout).toContain('Regression: CI failed on the merge commit: test job failed')
    expect(run.stdout).toContain('No revert PR: later commits changed the same files')
    expect(run.exitCode).toBe(0)
  })

  it('--rerun re-checks first, then reads; --json prints the payload', async () => {
    const run = await runCli(registerFixCommands, ['fixes', 'verify', FIX, '--rerun', '--json'], (c) =>
      c.method === 'POST' ? okReply({ queued: true }) : okReply(VERIFICATION))
    expect(run.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST /v1/admin/fixes/${FIX}/verify`,
      `GET /v1/admin/fixes/${FIX}/verification`,
    ])
    expect(JSON.parse(run.stdout)).toEqual({ ok: true, verification: VERIFICATION })
  })

  it('stops when the re-check is refused and reads nothing', async () => {
    const run = await runCli(registerFixCommands, ['fixes', 'verify', FIX, '--rerun'], () => errorReply(429, 'RATE_LIMITED', 'Six re-checks an hour'))
    expect(run.calls).toHaveLength(1)
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('Re-check not started: Six re-checks an hour')
  })

  it('rejects a fix id that is not a UUID before calling the API', async () => {
    const run = await runCli(registerFixCommands, ['fixes', 'verify', '../../projects'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })
})
