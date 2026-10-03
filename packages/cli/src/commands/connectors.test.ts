import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { okReply, runCli } from '../test-harness.js'
import type { ConnectorsData } from './connectors.js'
import { registerConnectorsCommands } from './connectors.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const data: ConnectorsData = {
  organizationId: 'org',
  available: [
    { kind: 'vercel', title: 'Vercel', capabilities: ['deploys'], legacyBacked: false },
    { kind: 'cloudflare', title: 'Cloudflare', capabilities: ['dns'], legacyBacked: false },
  ],
  planned: [],
  instances: [{
    id: 'c0ffee00-0000-4000-8000-000000000001',
    project_id: null,
    kind: 'vercel',
    display_name: 'Team Vercel',
    granted_scopes: ['read'],
    enabled_capabilities: ['deploys'],
    status: 'error',
    status_reason: 'Token expired',
    last_probe_at: '2026-10-01T00:00:00Z',
    last_ok_at: null,
    last_error: 'HTTP 401',
    bindings: [{ projectId: 'p1', externalId: 'prj_1', role: 'deploy' }],
  }],
  legacy: [{ kind: 'sentry', project_id: 'p2', ok: true, error: null, observed_at: '2026-10-01T00:00:00Z' }],
}

describe('mushi connectors list', () => {
  it('lists instances with status, legacy integrations and what can still be added', async () => {
    const run = await runCli(registerConnectorsCommands, ['connectors', 'list'], () => okReply(data))
    expect(run.calls).toEqual([expect.objectContaining({ method: 'GET', path: '/v1/admin/orgs/current/connectors' })])
    expect(run.stdout).toContain('ERROR')
    expect(run.stdout).toContain('Team Vercel')
    expect(run.stdout).toContain('Token expired')
    expect(run.stdout).toContain('sentry')
    expect(run.stdout).toContain('Available to add: cloudflare')
  })

  it('never sends a write', async () => {
    const run = await runCli(registerConnectorsCommands, ['connectors', 'list', '--json'], () => okReply(data))
    expect(run.calls.every((c) => c.method === 'GET')).toBe(true)
    expect(JSON.parse(run.stdout).instances).toHaveLength(1)
  })
})

describe('mushi connectors actions', () => {
  it('lists requested actions and points pending ones at the console', async () => {
    const run = await runCli(registerConnectorsCommands, ['connectors', 'actions'], () => okReply({ actions: [{
      id: 'a1', connector_instance_id: 'c1', project_id: null, action: 'redeploy', reason: 'stale build', status: 'pending_approval',
      requested_at: '2026-10-01T00:00:00Z', approved_at: null, expires_at: null, executed_at: null, error: null,
    }] }))
    expect(run.calls).toEqual([expect.objectContaining({ method: 'GET', path: '/v1/admin/orgs/current/connector-actions' })])
    expect(run.stdout).toContain('PENDING_APPROVAL')
    expect(run.stdout).toContain('why: stale build')
    expect(run.stdout).toContain('approves pending actions in the console')
  })
})

describe('mushi connectors status', () => {
  it('shows one connector by id prefix', async () => {
    const run = await runCli(registerConnectorsCommands, ['connectors', 'status', 'c0ffee00'], () => okReply(data))
    expect(run.stdout).toContain('status:        error (Token expired)')
    expect(run.stdout).toContain('last error:    HTTP 401')
    expect(run.stdout).toContain('p1 (deploy prj_1)')
  })

  it('fails with a hint for an unknown id', async () => {
    const run = await runCli(registerConnectorsCommands, ['connectors', 'status', 'deadbeef'], () => okReply(data))
    expect(run.error?.code).toBe('E_INVALID_INPUT')
    expect(run.error?.message).toContain('No connector deadbeef')
  })
})
