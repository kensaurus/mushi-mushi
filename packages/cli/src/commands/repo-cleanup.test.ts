import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerRepoCommands } from './repo.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const ITEM = '44444444-5555-4666-8777-888888888888'
const A = 'a'.repeat(40)

const view = {
  repos: [
    {
      repo: 'me/app',
      error: null,
      deleteBranchOnMerge: false,
      branches: [{ key: 'branch:mushi/fix-1', branch: 'mushi/fix-1', headSha: A, reason: 'Pull request #1 was merged on 2026-10-20.' }],
      prs: [{ key: 'pr:5', prNumber: 5, headSha: A, reason: 'Close #5: a newer fix for the same report is open as #6.' }],
      keptCount: 2,
      gone: 3,
    },
  ],
  actions: [{ id: 'act-1', action: 'delete_branches', repo: 'me/app', itemCount: 4, status: 'pending_approval', requestedAt: '2026-10-27T00:00:00Z' }],
  restorable: [{ id: ITEM, repo: 'me/app', branch: 'mushi/old', deleted_sha: A }],
  raceNote: 'A push in that second could be lost.',
}

describe('mushi repo cleanup', () => {
  it('show prints each item with its commit and reason, what waits, and what can be restored', async () => {
    const run = await runCli(registerRepoCommands, ['repo', 'cleanup', 'show', '--stale-days', '30'], () => okReply(view))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/repo-cleanup?staleDays=30`)
    expect(run.stdout).toContain('branch:mushi/fix-1  aaaaaaa  Pull request #1 was merged')
    expect(run.stdout).toContain('pr:5  aaaaaaa  Close #5')
    expect(run.stdout).toContain('(3 recorded branches already gone)')
    expect(run.stdout).toContain('act-1  delete_branches ×4 in me/app  (pending_approval)')
    expect(run.stdout).toContain(`${ITEM}  me/app mushi/old at aaaaaaa`)
    expect(run.stdout).toContain('mushi repo cleanup request auto-delete --repo me/app')
  })

  it('request asks for the chosen keys; it never approves or runs', async () => {
    const run = await runCli(registerRepoCommands, ['repo', 'cleanup', 'request', 'delete-branches', '--repo', 'me/app', '--keys', 'branch:a, branch:b', '--reason', 'merged'], () =>
      okReply({ id: 'act-2', payloadSha256: 'f'.repeat(64), next: 'A team owner or admin approves it in the console.', payload: { items: [{}, {}] } }),
    )
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/projects/${PID}/repo-cleanup/requests`, body: { action: 'delete_branches', repo: 'me/app', keys: ['branch:a', 'branch:b'], reason: 'merged' } })
    expect(run.stdout).toContain('Asked: act-2 (2 item(s)).')
  })

  it('refuses an unknown kind before calling the API, and shows the server refusal', async () => {
    const bad = await runCli(registerRepoCommands, ['repo', 'cleanup', 'request', 'delete-repo', '--repo', 'me/app'])
    expect(bad.calls).toHaveLength(0)
    expect(bad.error?.code).toBe('E_INVALID_INPUT')
    const limited = await runCli(registerRepoCommands, ['repo', 'cleanup', 'request', 'close-prs', '--repo', 'me/app'], () => errorReply(429, 'RATE_LIMITED', 'At most 5 clean-ups an hour per app.'))
    expect(limited.stderr).toContain('RATE_LIMITED')
    expect(limited.exitCode).not.toBe(0)
  })

  it('restore sends item ids and checks them first', async () => {
    const run = await runCli(registerRepoCommands, ['repo', 'cleanup', 'restore', ITEM], () => okReply({ id: 'act-3', next: 'Approve it in the console.' }))
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/projects/${PID}/repo-cleanup/restore`, body: { itemIds: [ITEM] } })
    const bad = await runCli(registerRepoCommands, ['repo', 'cleanup', 'restore', 'nope'])
    expect(bad.calls).toHaveLength(0)
    expect(bad.error?.code).toBe('E_INVALID_INPUT')
  })
})
