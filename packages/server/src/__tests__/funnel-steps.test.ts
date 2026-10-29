/**
 * FILE: packages/server/src/__tests__/funnel-steps.test.ts
 * PURPOSE: The new-user path steps (_shared/funnel-steps.ts, plan-simplicity
 *          Phase 0) are written once per project, never backdated onto an
 *          app that already had the step, always with an actor, and counted
 *          by company_funnel_weekly only for outside projects.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decideFirstStep,
  EARLIER_SETUP_STEP_MS,
  FUNNEL_STEPS,
  FunnelStepMemo,
  funnelStepDedupKey,
  setupStepWasEarlier,
} from '../../supabase/functions/_shared/funnel-steps.ts'
import { MUSHI_EVENTS } from '../../supabase/functions/_shared/analytics-taxonomy.generated.ts'

const SELF = '00000000-0000-4000-8000-000000000001'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const OWNER = '66666666-6666-4666-8666-666666666666'
const PERSON = '55555555-5555-4555-8555-555555555555'

const warn = vi.fn()
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: (...a: unknown[]) => warn(...a), error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})
vi.mock('../../supabase/functions/_shared/background.ts', () => ({ keepAlive: <T,>(p: Promise<T>) => p }))

beforeEach(() => warn.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('decideFirstStep', () => {
  it('emits only when the project had no earlier occurrence', () => {
    expect(decideFirstStep(0)).toBe('emit')
    expect(decideFirstStep(1)).toBe('not_first')
    expect(decideFirstStep(212)).toBe('not_first')
  })

  it('emits nothing when the earlier count could not be read', () => {
    expect(decideFirstStep(null)).toBe('unknown')
    expect(decideFirstStep(undefined)).toBe('unknown')
    expect(decideFirstStep(Number.NaN)).toBe('unknown')
  })
})

describe('FunnelStepMemo', () => {
  it('claims a (step, project) pair once per isolate', () => {
    const memo = new FunnelStepMemo()
    expect(memo.claim('first_fix_merged', PROJECT)).toBe(true)
    expect(memo.claim('first_fix_merged', PROJECT)).toBe(false)
    // Another step or project is its own pair.
    expect(memo.claim('first_fix_dispatched', PROJECT)).toBe(true)
    expect(memo.claim('first_fix_merged', SELF)).toBe(true)
  })

  it('releases a claim whose check failed, so a later call retries', () => {
    const memo = new FunnelStepMemo()
    memo.claim('sdk_seen_live', PROJECT)
    memo.release('sdk_seen_live', PROJECT)
    expect(memo.claim('sdk_seen_live', PROJECT)).toBe(true)
  })

  it('starts over when full instead of growing', () => {
    const memo = new FunnelStepMemo(2)
    memo.claim('sdk_seen_live', 'a')
    memo.claim('sdk_seen_live', 'b')
    memo.claim('sdk_seen_live', 'c')
    // Cleared at the third claim: 'a' is asked again (the dedup key still
    // keeps the row single), 'c' is remembered.
    expect(memo.claim('sdk_seen_live', 'a')).toBe(true)
    expect(memo.claim('sdk_seen_live', 'c')).toBe(false)
  })
})

describe('dedup keys and the taxonomy', () => {
  it('keys each step on the host project, since every row lands in the self project', () => {
    expect(funnelStepDedupKey('first_real_report', PROJECT)).toBe(`first_real_report:${PROJECT}`)
    expect(new Set(FUNNEL_STEPS.map((s) => funnelStepDedupKey(s, PROJECT))).size).toBe(FUNNEL_STEPS.length)
  })

  it('every step is a server-only taxonomy event keyed on its project', () => {
    for (const step of FUNNEL_STEPS) {
      const def = MUSHI_EVENTS[step as keyof typeof MUSHI_EVENTS]
      expect(def, step).toBeDefined()
      expect(def.surface, step).toBe('server')
      expect(def.required as readonly string[], step).toContain('project_id')
    }
  })

  it('first_report_received keeps its meaning; first_real_report is a separate step', () => {
    expect(MUSHI_EVENTS.first_report_received).toBeDefined()
    expect(FUNNEL_STEPS).not.toContain('first_report_received')
  })
})

describe('setupStepWasEarlier', () => {
  const now = Date.parse('2026-10-29T12:00:00Z')
  it('a setup row written by this request is not "earlier"', () => {
    expect(setupStepWasEarlier(null, now)).toBe(false)
    expect(setupStepWasEarlier(new Date(now - 2_000).toISOString(), now)).toBe(false)
  })
  it('a setup row from before is', () => {
    expect(setupStepWasEarlier(new Date(now - EARLIER_SETUP_STEP_MS - 1).toISOString(), now)).toBe(true)
    expect(setupStepWasEarlier('2026-07-01T00:00:00Z', now)).toBe(true)
  })
  it('an unreadable time is not "earlier"', () => {
    expect(setupStepWasEarlier('yesterday', now)).toBe(false)
  })
})

// ── Writes, through emitProductEvent with a fake database ───────────────────

type Row = Record<string, unknown>

function fakeDb(rows: Row[], counts: { dispatches?: number | null; attempts?: number | null } = {}) {
  const countQuery = (n: number | null | undefined) => {
    const result = n === null ? { count: null, error: { message: 'boom' } } : { count: n ?? 0, error: null }
    const q = { eq: () => q, neq: () => q, not: () => q, then: (r: (v: unknown) => unknown) => Promise.resolve(result).then(r) }
    return q
  }
  return {
    rpc: async () => ({ data: false, error: null }), // is_synthetic_subject
    from: (table: string) => {
      if (table === 'mushi_runtime_config') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
      if (table === 'end_users') return { upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'eu-1' }, error: null }) }) }) }
      if (table === 'projects') {
        return { select: (cols: string) => ({ eq: () => ({ maybeSingle: async () => ({ data: cols.includes('owner_id') ? { owner_id: OWNER } : { organization_id: 'org-self' }, error: null }) }) }) }
      }
      if (table === 'fix_dispatch_jobs') return { select: () => countQuery(counts.dispatches) }
      if (table === 'fix_attempts') return { select: () => countQuery(counts.attempts) }
      return {
        insert: async (row: Row) => {
          rows.push(row)
          return { error: null }
        },
      }
    },
  }
}

async function loadSteps() {
  vi.resetModules()
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'MUSHI_SELF_PROJECT_ID' ? SELF : undefined) } })
  return import('../../supabase/functions/_shared/funnel-steps.ts')
}

const flush = () => new Promise((r) => setTimeout(r, 20))

describe('emitFunnelStep', () => {
  it('writes one row keyed on the host project, attributed to the project owner when no person is known', async () => {
    const rows: Row[] = []
    const steps = await loadSteps()
    expect(await steps.emitFunnelStep(fakeDb(rows) as never, { step: 'sdk_seen_live', projectId: PROJECT, properties: { origin_kind: 'native' } })).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      project_id: SELF,
      event_name: 'sdk_seen_live',
      dedup_key: `sdk_seen_live:${PROJECT}`,
      end_user_id: 'eu-1',
      written_by: 'server',
    })
    expect(rows[0].properties).toMatchObject({ project_id: PROJECT, origin_kind: 'native', actor: 'project_owner' })
  })

  it('records the person when one is known', async () => {
    const rows: Row[] = []
    const steps = await loadSteps()
    await steps.emitFunnelStep(fakeDb(rows) as never, { step: 'first_diagnosis_viewed', projectId: PROJECT, actorUserId: PERSON })
    expect(rows[0].properties).toMatchObject({ actor: 'user' })
  })
})

describe('emitFirstFixDispatched', () => {
  it('emits for a project with no earlier dispatch or attempt, once per isolate', async () => {
    const rows: Row[] = []
    const steps = await loadSteps()
    const db = fakeDb(rows, { dispatches: 0, attempts: 0 })
    steps.emitFirstFixDispatched(db as never, { projectId: PROJECT, reportId: 'r1', dispatchId: 'd1', actorUserId: PERSON })
    steps.emitFirstFixDispatched(db as never, { projectId: PROJECT, reportId: 'r2', dispatchId: 'd2', actorUserId: PERSON })
    await vi.waitFor(() => expect(rows).toHaveLength(1))
    await flush()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ event_name: 'first_fix_dispatched', dedup_key: `first_fix_dispatched:${PROJECT}` })
    expect(rows[0].properties).toMatchObject({ report_id: 'r1', actor: 'user' })
  })

  it('does not stamp an app that already had dispatches or local-worker attempts', async () => {
    for (const counts of [{ dispatches: 3, attempts: 0 }, { dispatches: 0, attempts: 5 }]) {
      const rows: Row[] = []
      const steps = await loadSteps()
      steps.emitFirstFixDispatched(fakeDb(rows, counts) as never, { projectId: PROJECT, reportId: 'r', dispatchId: 'd' })
      await flush()
      await flush()
      expect(rows, JSON.stringify(counts)).toHaveLength(0)
    }
  })

  it('writes nothing and retries later when the lookup fails, and says so', async () => {
    const rows: Row[] = []
    const steps = await loadSteps()
    steps.emitFirstFixDispatched(fakeDb(rows, { dispatches: null }) as never, { projectId: PROJECT, reportId: 'r', dispatchId: 'd' })
    await flush()
    await flush()
    expect(rows).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('first_fix_dispatched: earlier-dispatch lookup failed; step not recorded yet', expect.anything())
    // The claim was released, so the next dispatch checks again.
    expect(steps.funnelStepMemo.claim('first_fix_dispatched', PROJECT)).toBe(true)
  })
})

describe('emitProductEvent actorFallback', () => {
  async function loadEmit() {
    vi.resetModules()
    vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'MUSHI_SELF_PROJECT_ID' ? SELF : undefined) } })
    return (await import('../../supabase/functions/_shared/product-events.ts')).emitProductEvent
  }

  it('attributes fix_merged to the project owner when the merge had no console user', async () => {
    const rows: Row[] = []
    const emit = await loadEmit()
    await emit(fakeDb(rows) as never, { actorFallback: 'project_owner', eventName: 'fix_merged', surface: 'server', properties: { project_id: PROJECT } })
    expect(rows[0]).toMatchObject({ end_user_id: 'eu-1' })
    expect(rows[0].properties).toMatchObject({ actor: 'project_owner' })
  })

  it('leaves events without the opt-in unattributed (anonymous visitors stay anonymous)', async () => {
    const rows: Row[] = []
    const emit = await loadEmit()
    await emit(fakeDb(rows) as never, { eventName: 'production_check_started', surface: 'server', properties: { project_id: PROJECT } })
    expect(rows[0]).toMatchObject({ end_user_id: null })
    expect(rows[0].properties).not.toHaveProperty('actor')
  })
})

// ── company_funnel_weekly reads the steps for outside projects only ─────────

describe('company_funnel_weekly new-user path', () => {
  const migrationsDir = resolve(__dirname, '../../supabase/migrations')
  const file = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(resolve(migrationsDir, f), 'utf8').includes('create or replace function public.company_funnel_weekly('))
    .pop()!
  const sql = readFileSync(resolve(migrationsDir, file), 'utf8')
  const cte = (name: string, next: string) => sql.slice(sql.indexOf(`${name} as (`), sql.indexOf(`${next} as (`))

  it('path_events loads exactly the funnel steps, joined to outside projects', () => {
    const path = cte('path_events', 'loop_events')
    const listed = [.../event_name in \(([^)]*)\)/.exec(path)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(listed.sort()).toEqual([...FUNNEL_STEPS].sort())
    expect(path).toContain("join proj on proj.id::text = e.properties ->> 'project_id'")
    expect(path).toContain('e.project_id = v_self')
  })

  it('reports one weekly key per step', () => {
    for (const step of FUNNEL_STEPS) expect(sql, step).toMatch(new RegExp(`'${step}',\\s+w\\.${step}`))
  })

  it('leaves complimentary organizations and synthetic accounts out of every project count', () => {
    expect(cte('proj', 'key_signals')).toContain("coalesce(o.billing_mode, '') <> 'complimentary'")
    expect(cte('people', 'proj')).toContain('public.synthetic_accounts sa where sa.user_id = u.id')
  })
})
