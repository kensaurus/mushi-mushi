/**
 * FILE: ci-placement-act.test.ts
 * PURPOSE: Changing where CI runs through a connector action (ADR 0037), on
 *          the real request → approve → execute code and the GitHub
 *          connector's act(), with a fake database and a fake GitHub:
 *            - a legacy GitHub request stores the payload and its hash, and
 *              nothing runs; before the migration it is 409 MIGRATION_PENDING;
 *            - approval needs the hash the approver saw; execution needs a
 *              fresh approval (expired → 410, not approved → 409);
 *            - act() refuses a tampered payload, a variable outside the
 *              allowlist, a policy refusal at execution time (the agreement
 *              changed after approval), a variable that moved since the
 *              preview (409 VARIABLE_MOVED), and a token without Variables
 *              write (403), each without writing;
 *            - it creates, updates or deletes the variable, and never uses a
 *              token other than the project's stored one.
 */

import { describe, expect, it } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import {
  approveConnectorAction,
  executeConnectorAction,
  payloadHash,
  requestLegacyConnectorAction,
} from '../../supabase/functions/_shared/connector-actions.ts'
import { getConnector } from '../../supabase/functions/_shared/connectors/index.ts'

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-22T12:00:00Z')
const REPO = 'kensaurus/yen-yen'

interface GhState {
  private: boolean
  variable: { value: string; updated_at: string } | null
  readStatus?: number
  writeStatus?: number
  calls: string[]
}

function github(state: GhState) {
  return async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.replace('https://api.github.com', '')
    state.calls.push(`${method} ${path}`)
    const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status })
    if (path === `/repos/${REPO}` && method === 'GET') return json(200, { private: state.private })
    if (path === `/repos/${REPO}/actions/variables/LINUX_RUNNER` && method === 'GET') {
      if (state.readStatus) return json(state.readStatus, { message: 'no' })
      return state.variable ? json(200, { name: 'LINUX_RUNNER', ...state.variable }) : json(404, { message: 'Not Found' })
    }
    if (method !== 'GET') {
      if (state.writeStatus) return json(state.writeStatus, { message: 'Resource not accessible by personal access token' })
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (method === 'DELETE') state.variable = null
      else state.variable = { value: body.value, updated_at: '2026-10-22T12:00:05Z' }
      return json(method === 'POST' ? 201 : 204, null)
    }
    return json(404, {})
  }
}

function setup(over: { policy?: Record<string, unknown> | null; gh?: Partial<GhState> } = {}) {
  const db = makeFakeDb(
    {
      ci_runner_policies: over.policy === null ? [] : [{ organization_id: ORG, no_paid_hosted_on_private: true, hosted_allowed_repos: [], external_controllers: [], standby_runners: ['kensaurus-local-*'], ...(over.policy ?? {}) }],
      ci_runners: [{ project_id: P1, repo: REPO, runner_name: 'alienware-yen-yen-1', status: 'online', busy: false, labels: ['self-hosted', 'kensaurus-local'] }],
    },
    { autoId: true },
  )
  const gh: GhState = { private: true, variable: null, calls: [], ...over.gh }
  const tokens: string[] = []
  const deps = {
    fetch: github(gh),
    now: () => NOW,
    legacyGithubToken: async (_db: unknown, projectId: string) => {
      tokens.push(projectId)
      return 'ghp_stored_pat'
    },
  }
  return { db, gh, deps, tokens }
}

const payload = (over: Record<string, unknown> = {}) => ({
  repo: REPO,
  name: 'LINUX_RUNNER',
  value: 'kensaurus-local',
  expected: { exists: false, value: null, updatedAt: null },
  jobs: [{ workflow: 'CI', job: 'Lint' }],
  expectedLabels: ['kensaurus-local'],
  ...over,
})

async function requestAndApprove(db: FakeDb, p: Record<string, unknown>, action = 'set_actions_variable') {
  const req = await requestLegacyConnectorAction(db as never, { organizationId: ORG, projectId: P1, kind: 'github', action, payload: p, requestedBy: 'u1' })
  if (!req.ok) throw new Error(req.message)
  const ok = await approveConnectorAction(db as never, req.value.id, ORG, 'owner1', NOW, req.value.payloadSha256)
  if (!ok.ok) throw new Error(ok.message)
  return req.value.id
}

describe('request and approval', () => {
  it('stores a legacy GitHub request with its hash; nothing runs', async () => {
    const { db, gh } = setup()
    const req = await requestLegacyConnectorAction(db as never, { organizationId: ORG, projectId: P1, kind: 'github', action: 'set_actions_variable', payload: payload(), requestedBy: 'mcp:key1' })
    expect(req.ok).toBe(true)
    const row = db.table('connector_actions')[0]
    expect(row).toMatchObject({ connector_instance_id: null, connector_kind: 'github', status: 'pending_approval', requested_by: 'mcp:key1' })
    expect(row.payload_sha256).toBe(await payloadHash(payload()))
    expect(gh.calls).toEqual([])
  })

  it('refuses an action GitHub does not declare', async () => {
    const { db } = setup()
    const req = await requestLegacyConnectorAction(db as never, { organizationId: ORG, projectId: P1, kind: 'github', action: 'set_secret', payload: payload(), requestedBy: 'u1' })
    expect(req).toMatchObject({ ok: false, code: 'ACTION_NOT_SUPPORTED', status: 400 })
  })

  it('says 409 MIGRATION_PENDING before the database update', async () => {
    const db = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '42703', message: 'column "connector_kind" does not exist' } }) }) }) }) }
    const req = await requestLegacyConnectorAction(db as never, { organizationId: ORG, projectId: P1, kind: 'github', action: 'set_actions_variable', payload: payload(), requestedBy: 'u1' })
    expect(req).toMatchObject({ ok: false, code: 'MIGRATION_PENDING', status: 409 })
  })

  it('approval needs the hash of what the approver saw', async () => {
    const { db } = setup()
    const req = await requestLegacyConnectorAction(db as never, { organizationId: ORG, projectId: P1, kind: 'github', action: 'set_actions_variable', payload: payload(), requestedBy: 'u1' })
    if (!req.ok) throw new Error('request failed')
    expect(await approveConnectorAction(db as never, req.value.id, ORG, 'owner1', NOW, 'f'.repeat(64))).toMatchObject({ ok: false, code: 'HASH_MISMATCH' })
    expect(await approveConnectorAction(db as never, req.value.id, ORG, 'owner1', NOW, req.value.payloadSha256)).toMatchObject({ ok: true, value: { expiresAt: '2026-10-22T13:00:00.000Z' } })
  })
})

describe('execute', () => {
  it('creates the variable with the stored PAT, records the result, and never runs twice', async () => {
    const { db, gh, deps, tokens } = setup()
    const id = await requestAndApprove(db, payload())
    const r = await executeConnectorAction(db as never, id, ORG, 'owner1', deps)
    expect(r.ok).toBe(true)
    expect(tokens).toEqual([P1])
    expect(gh.calls).toContain(`POST /repos/${REPO}/actions/variables`)
    expect(gh.variable).toEqual({ value: 'kensaurus-local', updated_at: '2026-10-22T12:00:05Z' })
    const row = db.table('connector_actions')[0]
    expect(row).toMatchObject({ status: 'executed', error: null })
    expect((row.result as { previous: unknown }).previous).toEqual({ exists: false, value: null, updatedAt: null })
    expect(await executeConnectorAction(db as never, id, ORG, 'owner1', deps)).toMatchObject({ ok: false, code: 'NOT_APPROVED' })
  })

  it('updates an existing variable with PATCH and deletes with DELETE when the expected state matches', async () => {
    const existing = { value: 'old-label', updated_at: '2026-10-21T15:11:00Z' }
    const s = setup({ gh: { variable: { ...existing } }, policy: { no_paid_hosted_on_private: false } })
    const id = await requestAndApprove(s.db, payload({ expected: { exists: true, value: 'old-label', updatedAt: '2026-10-21T15:11:00Z' } }))
    expect((await executeConnectorAction(s.db as never, id, ORG, 'owner1', s.deps)).ok).toBe(true)
    expect(s.gh.calls).toContain(`PATCH /repos/${REPO}/actions/variables/LINUX_RUNNER`)

    const d = setup({ gh: { variable: { ...existing } }, policy: { no_paid_hosted_on_private: false } })
    const del = await requestAndApprove(d.db, payload({ value: null, expected: { exists: true, value: 'old-label', updatedAt: '2026-10-21T15:11:00Z' }, expectedLabels: ['ubuntu-24.04'] }), 'delete_actions_variable')
    expect((await executeConnectorAction(d.db as never, del, ORG, 'owner1', d.deps)).ok).toBe(true)
    expect(d.gh.calls).toContain(`DELETE /repos/${REPO}/actions/variables/LINUX_RUNNER`)
    expect(d.gh.variable).toBeNull()
  })

  it('409 VARIABLE_MOVED when the variable changed after the preview, and writes nothing', async () => {
    const { db, gh, deps } = setup({ gh: { variable: { value: 'someone-else', updated_at: '2026-10-22T11:59:00Z' } } })
    const id = await requestAndApprove(db, payload())
    const r = await executeConnectorAction(db as never, id, ORG, 'owner1', deps)
    expect(r).toMatchObject({ ok: false, code: 'VARIABLE_MOVED', status: 409 })
    expect(gh.calls.filter((c) => !c.startsWith('GET'))).toEqual([])
    expect(db.table('connector_actions')[0]).toMatchObject({ status: 'failed' })
  })

  it('checks the policy again at execution: a change approved before the agreement turned it off is refused', async () => {
    const { db, gh, deps } = setup({ gh: { variable: { value: 'kensaurus-local', updated_at: 't0' } } })
    const id = await requestAndApprove(db, payload({ value: null, expected: { exists: true, value: 'kensaurus-local', updatedAt: 't0' }, expectedLabels: ['ubuntu-24.04'] }), 'delete_actions_variable')
    const r = await executeConnectorAction(db as never, id, ORG, 'owner1', deps)
    expect(r).toMatchObject({ ok: false, code: 'POLICY_NO_PAID_HOSTED', status: 403 })
    expect(gh.calls.filter((c) => !c.startsWith('GET'))).toEqual([])
  })

  it('refuses a standby runner and an external controller\'s repo at execution', async () => {
    const standby = setup()
    const s1 = await requestAndApprove(standby.db, payload({ value: 'kensaurus-local-yen-yen-1' }))
    expect(await executeConnectorAction(standby.db as never, s1, ORG, 'owner1', standby.deps)).toMatchObject({ ok: false, code: 'POLICY_STANDBY_TARGET' })
    const ext = setup({ policy: { external_controllers: [{ name: 'kci dispatcher', owner: 'sbc-visual', repos: [REPO] }] } })
    const s2 = await requestAndApprove(ext.db, payload())
    expect(await executeConnectorAction(ext.db as never, s2, ORG, 'owner1', ext.deps)).toMatchObject({ ok: false, code: 'EXTERNAL_CONTROLLER', status: 403 })
  })

  it('refuses a variable outside the allowlist even if someone stored and approved it', async () => {
    const { db, gh, deps } = setup()
    const id = await requestAndApprove(db, payload({ name: 'EXPO_PUBLIC_API_URL', value: 'https://evil.example' }))
    const r = await executeConnectorAction(db as never, id, ORG, 'owner1', deps)
    expect(r).toMatchObject({ ok: false, code: 'VARIABLE_NOT_ALLOWED', status: 403 })
    expect(gh.calls).toEqual([])
  })

  it('says plainly when the token cannot read or write variables', async () => {
    const read = setup({ gh: { readStatus: 403 } })
    const r1 = await requestAndApprove(read.db, payload())
    const out1 = await executeConnectorAction(read.db as never, r1, ORG, 'owner1', read.deps)
    expect(out1).toMatchObject({ ok: false, code: 'GITHUB_VARIABLES_PERMISSION', status: 403 })
    expect(out1.ok ? '' : out1.message).toMatch(/Variables: Read and write/)
    const write = setup({ gh: { writeStatus: 403 } })
    const r2 = await requestAndApprove(write.db, payload())
    expect(await executeConnectorAction(write.db as never, r2, ORG, 'owner1', write.deps)).toMatchObject({ ok: false, code: 'GITHUB_VARIABLES_PERMISSION' })
  })

  it('an approval older than an hour has expired (410), and no token is a clear 409', async () => {
    const { db, deps } = setup()
    const id = await requestAndApprove(db, payload())
    const late = { ...deps, now: () => new Date(NOW.getTime() + 61 * 60_000) }
    expect(await executeConnectorAction(db as never, id, ORG, 'owner1', late)).toMatchObject({ ok: false, code: 'APPROVAL_EXPIRED', status: 410 })
    const none = setup()
    const id2 = await requestAndApprove(none.db, payload())
    expect(await executeConnectorAction(none.db as never, id2, ORG, 'owner1', { ...none.deps, legacyGithubToken: async () => null })).toMatchObject({ ok: false, code: 'NO_GITHUB_TOKEN', status: 409 })
  })

  it('a tampered payload is refused by act() itself', async () => {
    const c = getConnector('github')
    const r = await c.act!({ db: setup().db as never, organizationId: ORG, projectId: P1, readCredential: 't', writeCredential: 't', config: {}, fetch: github({ private: true, variable: null, calls: [] }), now: () => NOW }, { id: 'a', action: 'set_actions_variable', payload: payload(), payloadSha256: 'f'.repeat(64) })
    expect(r).toMatchObject({ ok: false, detail: 'The payload does not match what was approved.' })
  })
})
