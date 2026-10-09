import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { okReply, runCli, TEST_CONFIG, TEST_PROJECT_ID } from '../test-harness.js'
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
