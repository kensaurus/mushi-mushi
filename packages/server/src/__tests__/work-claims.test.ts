/**
 * FILE: work-claims.test.ts
 * PURPOSE: The local-worker lease as every dispatcher reads it (ADR 0048,
 *          _shared/work-claims.ts):
 *            - a claim counts only while active and unexpired;
 *            - a missing table (migration not applied) reads as "no claims",
 *              any other read error is returned so the caller skips;
 *            - dispatchFixForReport (spend-down, skill-run rounds, Slack,
 *              Linear) does not dispatch a held report, nor one whose lease
 *              it cannot read;
 *            - a worker:run key records a fix only on its own host's claim.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({ db: null as unknown }))
const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/team-notify.ts', () => ({ notifyTeamFixEvent: async () => {} }))

let claims: typeof import('../../supabase/functions/_shared/work-claims.ts')
let dispatch: typeof import('../../supabase/functions/_shared/dispatch.ts')
beforeAll(async () => {
  claims = await import('../../supabase/functions/_shared/work-claims.ts')
  dispatch = await import('../../supabase/functions/_shared/dispatch.ts')
})

const NOW = new Date('2026-10-27T12:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const KEY = '9000000a-0000-4000-8000-000000000000'
const claim = (report: string, leaseUntil: string, over: Record<string, unknown> = {}) => ({ id: `c-${report}`, report_id: report, host_id: 'h1', status: 'active', lease_until: leaseUntil, ...over })

function ctx(vars: Record<string, unknown>) {
  return {
    get: (k: string) => vars[k],
    json: (body: unknown, status = 200) => ({ body, status }),
  } as never
}

describe('activeWorkClaims', () => {
  it('counts active, unexpired claims only', async () => {
    const db = makeFakeDb({ work_claims: [claim('r1', '2026-10-27T12:30:00Z'), claim('r2', '2026-10-27T11:00:00Z'), claim('r3', '2026-10-27T12:30:00Z', { status: 'done' })] })
    const res = await claims.activeWorkClaims(db as never, ['r1', 'r2', 'r3'], NOW)
    expect(res).toEqual({ ids: new Set(['r1']) })
  })
  it('reads a missing table as "no claims" and returns any other error', async () => {
    // Postgres says 42P01; hosted PostgREST says PGRST205 when its schema cache has no such table.
    for (const code of ['42P01', 'PGRST205']) {
      const missing = makeFakeDb({}, { failRead: () => ({ code, message: 'work_claims is not there' }) })
      expect(await claims.activeWorkClaims(missing as never, ['r1'], NOW)).toEqual({ ids: new Set() })
    }
    const broken = makeFakeDb({}, { failRead: () => 'connection reset' })
    expect(await claims.activeWorkClaims(broken as never, ['r1'], NOW)).toEqual({ error: 'connection reset' })
    expect(await claims.reportHasActiveWorkClaim(broken as never, 'r1', NOW)).toBeNull()
  })
})

describe('dispatchFixForReport and the lease', () => {
  const seed = (extra: Record<string, unknown[]> = {}, opts: Parameters<typeof makeFakeDb>[1] = {}) =>
    makeFakeDb(
      {
        project_settings: [{ project_id: P1, autofix_enabled: true }],
        reports: [{ id: 'r1', project_id: P1, status: 'classified', category: 'bug' }],
        fix_attempts: [],
        fix_dispatch_jobs: [],
        ...extra,
      },
      { autoId: true, ...opts },
    )

  it('does not dispatch a report a local worker holds', async () => {
    const db: FakeDb = seed({ work_claims: [claim('r1', '2099-01-01T00:00:00Z')] })
    state.db = db
    const res = await dispatch.dispatchFixForReport({ projectId: P1, reportId: 'r1', skipMembershipCheck: true, trigger: 'automatic' })
    expect(res).toMatchObject({ ok: false, code: 'ALREADY_DISPATCHED' })
    expect(db.table('fix_dispatch_jobs')).toHaveLength(0)
  })

  it('does not dispatch when the lease cannot be read', async () => {
    const db: FakeDb = seed({}, { failRead: (t) => (t === 'work_claims' ? 'connection reset' : null) })
    state.db = db
    const res = await dispatch.dispatchFixForReport({ projectId: P1, reportId: 'r1', skipMembershipCheck: true, trigger: 'automatic' })
    expect(res).toMatchObject({ ok: false, code: 'DISPATCH_FAILED' })
    expect(db.table('fix_dispatch_jobs')).toHaveLength(0)
  })
})

describe('workerClaimDenial: a worker key records fixes only on its own claim', () => {
  const db = () =>
    makeFakeDb({
      work_claims: [claim('mine', '2099-01-01T00:00:00Z', { host_id: 'h1' }), claim('theirs', '2099-01-01T00:00:00Z', { host_id: 'h2' }), claim('stale', '2026-01-01T00:00:00Z', { host_id: 'h1' })],
      work_hosts: [
        { id: 'h1', api_key_id: KEY, revoked_at: null },
        { id: 'h2', api_key_id: 'other-key', revoked_at: null },
      ],
    })
  const worker = ctx({ authMethod: 'apiKey', apiKeyScopes: ['worker:run'], apiKeyId: KEY })

  it('lets a console session and an mcp:write key through without a claim', async () => {
    expect(await claims.workerClaimDenial(ctx({ authMethod: 'jwt' }), db() as never, 'x', NOW)).toBeNull()
    expect(await claims.workerClaimDenial(ctx({ authMethod: 'apiKey', apiKeyScopes: ['mcp:write'], apiKeyId: 'k' }), db() as never, 'x', NOW)).toBeNull()
  })

  it('allows its own active claim and refuses anything else', async () => {
    expect(await claims.workerClaimDenial(worker, db() as never, 'mine', NOW)).toBeNull()
    for (const report of ['theirs', 'stale', 'none', null]) {
      const res = (await claims.workerClaimDenial(worker, db() as never, report, NOW)) as unknown as { status: number; body: { error: { code: string } } }
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('NO_WORK_CLAIM')
    }
  })
})
