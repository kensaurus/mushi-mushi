/**
 * FILE: packages/server/src/__tests__/report-pipeline-routes.test.ts
 * PURPOSE: The report page's Pipeline strip routes (api/routes/report-pipeline.ts)
 *          and the shared queue actions (api/queue-actions.ts):
 *
 *   - GET returns the trail for a report the caller can open, 404 otherwise.
 *   - POST retry: validated stage, viewers refused, members allowed,
 *     rate-limited (and a broken rate limit refuses, never lets through),
 *     idempotent (a second click fires nothing), compare-and-set on the job.
 *   - recoverStranded acts only on the projects it is given.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = 'a0000000-0000-4000-8000-0000000000aa'
const OTHER = 'a0000000-0000-4000-8000-0000000000bb'
const R = 'b0000000-0000-4000-8000-000000000001'
const R2 = 'b0000000-0000-4000-8000-000000000002'
const ME = 'c0000000-0000-4000-8000-000000000001'

let db: FakeDb
let role: 'owner' | 'member' | 'viewer' = 'member'
let rateMode: 'ok' | 'limited' | 'broken' = 'ok'
const NOW = new Date('2026-11-19T12:00:00Z')
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', ME)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock('../../supabase/functions/api/helpers.ts', () => ({ triggerClassification: vi.fn() }))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    canAccessReportProject: async (_c: unknown, _db: unknown, _u: string, pid: string) => pid === P,
    userCanAccessProject: async (_db: unknown, _u: string, pid: string) => (pid === P ? { allowed: true, role } : { allowed: false, role: null }),
  }
})

const trigger = vi.fn()
let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const mod = await import('../../supabase/functions/api/routes/report-pipeline.ts')
  app = new Hono()
  mod.registerReportPipelineRoutes(app as never, { now: () => NOW, trigger })
})

function seed(over: { reports?: Record<string, unknown>[]; queue?: Record<string, unknown>[] } = {}) {
  db = makeFakeDb(
    {
      reports: over.reports ?? [
        {
          id: R,
          project_id: P,
          status: 'new',
          created_at: minsAgo(60),
          processing_error: null,
          processing_attempts: 1,
          stage1_classification: null,
          stage1_latency_ms: null,
          stage2_analysis: null,
          stage2_latency_ms: null,
        },
      ],
      processing_queue: over.queue ?? [
        {
          id: 'q1',
          report_id: R,
          project_id: P,
          stage: 'stage1',
          status: 'failed',
          attempts: 2,
          max_attempts: 3,
          last_error: 'Stage 1 failed: 500 boom',
          scheduled_at: minsAgo(60),
          created_at: minsAgo(60),
          started_at: minsAgo(59),
          completed_at: minsAgo(58),
        },
      ],
      fix_attempts: [],
      deploy_observations: [],
    },
    {
      uniques: { processing_queue: ['report_id', 'stage'] },
      rpcError: (fn) =>
        fn !== 'scoped_rate_limit_claim' || rateMode === 'ok'
          ? null
          : rateMode === 'limited'
            ? { code: 'P0001', message: 'rate_limit_exceeded' }
            : { code: '42883', message: 'function does not exist' },
    },
  )
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } }
}

beforeEach(() => {
  role = 'member'
  rateMode = 'ok'
  trigger.mockClear()
  seed()
})

describe('GET /v1/admin/reports/:id/pipeline', () => {
  it('returns the trail with the failed quick check in plain words', async () => {
    const res = await call('GET', `/v1/admin/reports/${R}/pipeline`)
    expect(res.status).toBe(200)
    const stages = res.json.data!.stages as Array<{ id: string; state: string; problem: string | null; retry: { allowed: boolean } | null }>
    expect(stages.map((s) => s.id)).toEqual(['received', 'triage', 'diagnosis', 'fix', 'pr', 'ci', 'merge', 'deploy'])
    expect(stages[1]).toMatchObject({ state: 'failed', problem: 'The triage worker crashed on this report.', retry: { allowed: true } })
    expect(res.json.data!.failing).toBe('triage')
    expect((res.json.data!.jobs as unknown[]).length).toBe(1)
  })

  it('answers 404 for a report outside your apps and 400 for a bad id', async () => {
    seed({ reports: [{ id: R2, project_id: OTHER, status: 'new', created_at: minsAgo(5) }], queue: [] })
    expect((await call('GET', `/v1/admin/reports/${R2}/pipeline`)).status).toBe(404)
    expect((await call('GET', '/v1/admin/reports/not-a-uuid/pipeline')).status).toBe(400)
  })
})

describe('POST /v1/admin/reports/:id/pipeline/retry', () => {
  it('validates the stage', async () => {
    expect((await call('POST', `/v1/admin/reports/${R}/pipeline/retry`, {})).status).toBe(400)
    const fixStage = await call('POST', `/v1/admin/reports/${R}/pipeline/retry`, { stage: 'fix' })
    expect(fixStage.status).toBe(400)
    expect(fixStage.json.error!.message).toContain('/v1/admin/fixes/dispatch')
    expect(trigger).not.toHaveBeenCalled()
  })

  it('refuses a viewer and fires nothing', async () => {
    role = 'viewer'
    const res = await call('POST', `/v1/admin/reports/${R}/pipeline/retry`, { stage: 'triage' })
    expect(res.status).toBe(403)
    expect(trigger).not.toHaveBeenCalled()
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.tables.processing_queue![0]!.status).toBe('failed')
  })

  it('a member retries a failed job once; the second click fires nothing and spends no rate limit', async () => {
    const first = await call('POST', `/v1/admin/reports/${R}/pipeline/retry`, { stage: 'triage' })
    expect(first.status).toBe(200)
    expect(first.json.data!.outcome).toBe('queued')
    expect(db.tables.processing_queue![0]).toMatchObject({ status: 'pending', attempts: 0, last_error: null, completed_at: null })
    expect(trigger).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveBeenCalledWith(R, P)
    expect(db.rpcCalls.map((c) => c.args.p_scope)).toEqual(['report_pipeline_retry'])

    const second = await call('POST', `/v1/admin/reports/${R}/pipeline/retry`, { stage: 'triage' })
    expect(second.status).toBe(200)
    expect(second.json.data!.outcome).toBe('already')
    expect(trigger).toHaveBeenCalledTimes(1)
    expect(db.rpcCalls).toHaveLength(1)
  })

  it('refuses a diagnosed report', async () => {
    seed({
      reports: [{ id: R, project_id: P, status: 'classified', created_at: minsAgo(60), stage1_classification: {}, stage2_analysis: {} }],
      queue: [{ id: 'q1', report_id: R, project_id: P, stage: 'stage1', status: 'completed', created_at: minsAgo(60), completed_at: minsAgo(59) }],
    })
    const res = await call('POST', `/v1/admin/reports/${R}/pipeline/retry`, { stage: 'diagnosis' })
    expect(res.status).toBe(409)
    expect(res.json.error!.code).toBe('NOT_RETRYABLE')
    expect(trigger).not.toHaveBeenCalled()
  })

  it('answers 429 over the limit and 503 when the limit cannot be checked, firing nothing', async () => {
    rateMode = 'limited'
    expect((await call('POST', `/v1/admin/reports/${R}/pipeline/retry`, { stage: 'triage' })).status).toBe(429)
    rateMode = 'broken'
    const broken = await call('POST', `/v1/admin/reports/${R}/pipeline/retry`, { stage: 'triage' })
    expect(broken.status).toBe(503)
    expect(broken.json.error!.code).toBe('RATE_LIMIT_UNAVAILABLE')
    expect(trigger).not.toHaveBeenCalled()
    expect(db.tables.processing_queue![0]!.status).toBe('failed')
  })

  it('creates the missing job for a stranded report and releases a circuit-breaker hold', async () => {
    seed({ reports: [{ id: R, project_id: P, status: 'queued', created_at: minsAgo(60), stage1_classification: null, stage2_analysis: null }], queue: [] })
    const res = await call('POST', `/v1/admin/reports/${R}/pipeline/retry`, { stage: 'triage' })
    expect(res.json.data!.outcome).toBe('queued')
    expect(db.tables.processing_queue).toHaveLength(1)
    expect(db.tables.processing_queue![0]).toMatchObject({ report_id: R, stage: 'stage1', status: 'pending' })
    expect(db.tables.reports![0]!.status).toBe('new')
    expect(trigger).toHaveBeenCalledTimes(1)
  })
})

describe('queue actions', () => {
  it('applyTriageRetry loses the race quietly: the job moved since it was read', async () => {
    const { applyTriageRetry } = await import('../../supabase/functions/api/queue-actions.ts')
    db.tables.processing_queue![0]!.status = 'pending'
    const out = await applyTriageRetry(
      db as never,
      { report: { id: R, status: 'new' }, projectId: P, job: { id: 'q1', status: 'failed' } as never },
      trigger,
      NOW,
    )
    expect(out.outcome).toBe('already')
    expect(trigger).not.toHaveBeenCalled()
  })

  it('recoverStranded only touches the projects it is given', async () => {
    const { recoverStranded, recoverSummary } = await import('../../supabase/functions/api/queue-actions.ts')
    seed({
      reports: [
        { id: R, project_id: P, status: 'queued', created_at: minsAgo(30), processing_attempts: 0 },
        { id: R2, project_id: OTHER, status: 'new', created_at: minsAgo(30), processing_attempts: 0 },
      ],
      queue: [],
    })
    const out = await recoverStranded(db as never, [P], trigger, NOW)
    expect(out.reports).toBe(1)
    expect(trigger).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveBeenCalledWith(R, P)
    expect(db.tables.reports!.find((r) => r.id === R)!.status).toBe('new')
    expect(recoverSummary(out)).toBe('Re-sent 1 stuck report to triage.')
    expect(recoverSummary({ reports: 0, queue: 0, reconciled: 0 })).toBe('Nothing was stuck; nothing to recover.')
  })
})
