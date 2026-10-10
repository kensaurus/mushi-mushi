/**
 * Linear accepts OAuth access tokens only as `Bearer <token>` and personal API
 * keys only as the raw value. The health probes and the agent-session helpers
 * sent OAuth tokens raw, so OAuth installs probed as 401 and agent activity
 * posts failed. Issue creation returned empty ids on a failed issueCreate (and
 * the legacy path ignored HTTP/GraphQL errors), so a failed sync counted as
 * synced; a missing team id went to Linear as ''. refreshLinearToken ignored
 * Vault write errors after Linear had rotated the refresh token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

const mocks = vi.hoisted(() => ({ linearGql: vi.fn() }))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) noop[level] = () => {}
  noop.child = () => noop
  return { log: noop, createLogger: () => noop }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let envVars: Record<string, string> = {}
const fetchMock = vi.fn()

beforeEach(() => {
  envVars = {}
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => envVars[k] } }
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../../supabase/functions/_shared/linear.ts')
  vi.resetModules()
})

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const authOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>).Authorization

describe('Linear Authorization scheme', () => {
  it('probeLinear sends Bearer for an OAuth token and the raw value for an API key', async () => {
    const { probeLinear } = await import('../../supabase/functions/_shared/integration-probes.ts')
    fetchMock.mockImplementation(async () => ok({ data: { viewer: { id: 'u', name: 'n', organization: { name: 'o', urlKey: 'k' } } } }))
    const db = makeFakeDb({})
    await probeLinear({ linear_access_token_ref: 'lin_oauth_abc' } as never, db as never)
    await probeLinear({ linear_api_key_ref: 'lin_api_xyz' } as never, db as never)
    expect(authOf(fetchMock.mock.calls[0])).toBe('Bearer lin_oauth_abc')
    expect(authOf(fetchMock.mock.calls[1])).toBe('lin_api_xyz')
  })

  it('agent-session helpers send the actor token as Bearer', async () => {
    const { postAgentActivity, getAgentSessionContext } = await import('../../supabase/functions/_shared/linear-agent.ts')
    fetchMock.mockImplementation(async () => ok({ data: { agentSessionCreateActivity: { success: true } } }))
    await postAgentActivity('lin_oauth_actor', 's1', { type: 'thought', body: 'x' })
    await getAgentSessionContext('lin_oauth_actor', 's1')
    expect(fetchMock.mock.calls.map(authOf)).toEqual(['Bearer lin_oauth_actor', 'Bearer lin_oauth_actor'])
  })
})

describe('createExternalIssue (Linear)', () => {
  const report = { id: 'r1', summary: 's', description: 'd', category: 'bug', severity: 'high', component: null }

  async function load() {
    vi.doMock('../../supabase/functions/_shared/linear.ts', () => ({ linearGql: mocks.linearGql }))
    return import('../../supabase/functions/_shared/integrations.ts')
  }

  it('does not report a sync when issueCreate fails', async () => {
    const { createExternalIssue } = await load()
    mocks.linearGql.mockReset().mockResolvedValue({ issueCreate: { success: false, issue: null } })
    const db = makeFakeDb({ project_integrations: [], project_settings: [{ project_id: 'p1', linear_access_token_ref: 't', linear_team_id: 'T1' }] })
    expect(await createExternalIssue(db as never, 'p1', report as never)).toEqual([])
  })

  it('refuses to call Linear without a team id', async () => {
    const { createExternalIssue } = await load()
    mocks.linearGql.mockReset()
    const db = makeFakeDb({ project_integrations: [], project_settings: [{ project_id: 'p1', linear_access_token_ref: 't', linear_team_id: null }] })
    expect(await createExternalIssue(db as never, 'p1', report as never)).toEqual([])
    expect(mocks.linearGql).not.toHaveBeenCalled()
  })

  it('treats GraphQL errors on the legacy apiKey path as a failure', async () => {
    const { createExternalIssue } = await load()
    mocks.linearGql.mockReset().mockRejectedValue(new Error('No Linear credentials configured for project p1'))
    fetchMock.mockResolvedValue(ok({ errors: [{ message: 'Argument Validation Error' }] }))
    const db = makeFakeDb({
      project_integrations: [{ id: 'i1', project_id: 'p1', is_active: true, integration_type: 'linear', config: { apiKey: 'lin_api_k', teamId: 'T1' } }],
      project_settings: [{ project_id: 'p1', linear_team_id: null }],
    })
    expect(await createExternalIssue(db as never, 'p1', report as never)).toEqual([])
  })

  it('returns the created issue', async () => {
    const { createExternalIssue } = await load()
    mocks.linearGql.mockReset().mockResolvedValue({ issueCreate: { success: true, issue: { id: 'x', identifier: 'ENG-1', url: 'https://linear.app/i/ENG-1' } } })
    const db = makeFakeDb({ project_integrations: [], project_settings: [{ project_id: 'p1', linear_access_token_ref: 't', linear_team_id: 'T1' }] })
    expect(await createExternalIssue(db as never, 'p1', report as never)).toEqual([
      { externalId: 'ENG-1', url: 'https://linear.app/i/ENG-1', provider: 'linear' },
    ])
  })
})

describe('refreshLinearToken', () => {
  it('throws when Vault refuses the rotated refresh token', async () => {
    const { refreshLinearToken } = await import('../../supabase/functions/_shared/linear.ts')
    envVars.LINEAR_OAUTH_CLIENT_ID = 'cid'
    envVars.LINEAR_OAUTH_CLIENT_SECRET = 'csec'
    fetchMock.mockResolvedValue(ok({ access_token: 'new-access', refresh_token: 'new-refresh' }))
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) =>
      String(args.secret_name).endsWith('refresh_token') ? { data: null, error: { message: 'vault down' } } : { data: 'id', error: null })
    const db = {
      rpc,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { linear_refresh_token_ref: 'old-refresh' }, error: null }) }) }) }),
    }
    await expect(refreshLinearToken(db as never, 'p1')).rejects.toThrow(/refresh token/)
  })
})
