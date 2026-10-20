/**
 * FILE: spend-down.test.ts
 * PURPOSE: Spend-down mode (ADR 0028). The rules in _shared/spend-down.ts,
 *          and the worker on an in-memory database: which apps a key pays
 *          for (ADR 0023), the window, the daily limit, the auto-fix caps,
 *          the 3-running bound, the 7-day re-dispatch cooldown, and the
 *          dispatch metadata fix-worker reads (cursor_cloud, model, trigger).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  firstCursorKeyFor,
  projectCapacity,
  rankSpendDownCandidates,
  reportsWithNoRetryVerdict,
  type CursorPoolKey,
  spendDownDispatchMetadata,
  spendDownProjectIds,
  spendDownWindow,
  type SpendDownKey,
} from '../../supabase/functions/_shared/spend-down.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (_n: string, h: unknown) => h, reportError: () => {} }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/dispatch.ts', () => ({ dispatchFixForReport: async () => ({ ok: true }) }))
vi.mock('../../supabase/functions/_shared/autofix-budget.ts', () => ({ checkAutofixBudget: async () => ({ allowed: true }) }))

let worker: typeof import('../../supabase/functions/spend-down-worker/index.ts')
beforeAll(async () => {
  worker = await import('../../supabase/functions/spend-down-worker/index.ts')
})

const NOW = new Date('2026-10-20T09:00:00Z')
const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const P3 = '1000000c-0000-4000-8000-000000000000'

const key = (over: Partial<SpendDownKey> = {}): SpendDownKey => ({
  id: 'k1',
  provider_slug: 'cursor',
  project_id: null,
  organization_id: ORG,
  status: 'active',
  credits_expire_at: '2026-10-25T00:00:00Z',
  spend_down_enabled: true,
  spend_down_model: 'grok-4.7?reasoning_effort=xhigh&context=500k',
  spend_down_daily_limit: 10,
  spend_down_window_days: 14,
  ...over,
})

describe('spendDownWindow', () => {
  it('is active between expiry minus the window and expiry', () => {
    expect(spendDownWindow(key(), NOW)).toMatchObject({ state: 'active', startsAt: '2026-10-11T00:00:00.000Z' })
  })
  it('waits before the window, stops at expiry, and is off without a date or for other providers', () => {
    expect(spendDownWindow(key({ credits_expire_at: '2026-12-31T00:00:00Z' }), NOW).state).toBe('not_started')
    expect(spendDownWindow(key({ credits_expire_at: '2026-10-20T08:00:00Z' }), NOW).state).toBe('expired')
    expect(spendDownWindow(key({ credits_expire_at: null }), NOW).state).toBe('off')
    expect(spendDownWindow(key({ provider_slug: 'openai' }), NOW).state).toBe('off')
    expect(spendDownWindow(key({ spend_down_enabled: false }), NOW).state).toBe('off')
  })
  it('does not spend a key that failed its test or is out of quota', () => {
    expect(spendDownWindow(key({ status: 'auth_failed' }), NOW).state).toBe('key_unusable')
  })
})

describe('spendDownProjectIds: the apps where this key is the resolver\'s first pick (ADR 0023)', () => {
  const project = (id: string, over: Record<string, unknown> = {}) => ({
    id, organization_id: ORG, autofix_enabled: true, has_repo: true, has_legacy_key: false, ...over,
  })
  const pool = (id: string, over: Partial<CursorPoolKey> = {}): CursorPoolKey => ({
    id, project_id: null, organization_id: ORG, priority: 100, status: 'active', test_status: 'ok', ...over,
  })
  const projects = [project(P1), project(P2), project(P3, { autofix_enabled: false })]

  it('a shared key serves apps without a usable key of their own, with auto-fix on and a repo', () => {
    const keys = [pool('k1'), pool('own', { project_id: P2, organization_id: null })]
    expect(spendDownProjectIds(key(), projects, keys)).toEqual([P1])
  })

  it("an app's own key serves that app only, and a legacy key beats a shared one", () => {
    const keys = [pool('k1'), pool('own', { project_id: P2, organization_id: null })]
    expect(spendDownProjectIds({ id: 'own' }, projects, keys)).toEqual([P2])
    expect(spendDownProjectIds(key(), [project(P1, { has_legacy_key: true })], keys)).toEqual([])
  })

  it('with two shared keys, only the one the resolver picks first pays (priority), and a tie pays for nothing', () => {
    const second = pool('k2', { priority: 50 })
    expect(spendDownProjectIds(key(), [project(P1)], [pool('k1'), second])).toEqual([])
    expect(spendDownProjectIds({ id: 'k2' }, [project(P1)], [pool('k1'), second])).toEqual([P1])
    expect(spendDownProjectIds(key(), [project(P1)], [pool('k1'), pool('k2')])).toEqual([])
  })

  it('two own keys on one app: the lower priority wins; a key that failed its test is skipped', () => {
    const a = pool('a', { project_id: P1, organization_id: null, priority: 10 })
    const b = pool('b', { project_id: P1, organization_id: null, priority: 20 })
    expect(firstCursorKeyFor(project(P1), [a, b])).toBe('a')
    expect(firstCursorKeyFor(project(P1), [{ ...a, test_status: 'auth_failed' }, b])).toBe('b')
    expect(firstCursorKeyFor(project(P1), [{ ...a, status: 'disabled' }, pool('k1')])).toBe('k1')
  })
})

describe('reportsWithNoRetryVerdict', () => {
  it('settles a report only when its newest attempt carries an agent verdict', () => {
    const out = reportsWithNoRetryVerdict([
      { report_id: 'a', failure_category: 'already_fixed', created_at: '2026-10-20T08:00:00Z' },
      { report_id: 'd', failure_category: 'not_actionable', created_at: '2026-10-20T08:00:00Z' },
      { report_id: 'e', failure_category: 'needs_human', created_at: '2026-10-20T08:00:00Z' },
      { report_id: 'b', failure_category: 'wrong_repo', created_at: '2026-10-20T07:00:00Z' },
      { report_id: 'b', failure_category: null, created_at: '2026-10-20T09:00:00Z' },
      { report_id: 'c', failure_category: 'cursor_api_error', created_at: '2026-10-20T08:00:00Z' },
    ])
    expect([...out].sort()).toEqual(['a', 'd', 'e'])
  })
})

describe('rankSpendDownCandidates', () => {
  it('orders by severity, judge score and a named component, one per group', () => {
    const ranked = rankSpendDownCandidates([
      { id: 'low', severity: 'low', judge_score: 0.9, component: 'a.ts', report_group_id: null, created_at: '2026-10-19' },
      { id: 'crit-dup', severity: 'critical', judge_score: 0.5, component: null, report_group_id: 'g1', created_at: '2026-10-18' },
      { id: 'crit', severity: 'critical', judge_score: 0.6, component: null, report_group_id: 'g1', created_at: '2026-10-19' },
      { id: 'high-comp', severity: 'high', judge_score: 0.8, component: 'src/x.tsx', report_group_id: null, created_at: '2026-10-17' },
    ])
    expect(ranked.map((r) => r.id)).toEqual(['high-comp', 'crit', 'low'])
  })
})

describe('projectCapacity', () => {
  it('takes the tightest of the key, the 3-running bound and the auto-fix cap', () => {
    expect(projectCapacity({ remainingForKey: 10, openCloudAttempts: 1, autofixDispatchesToday: 0, autofixMaxPerDay: null })).toBe(2)
    expect(projectCapacity({ remainingForKey: 10, openCloudAttempts: 0, autofixDispatchesToday: 2, autofixMaxPerDay: 3 })).toBe(1)
    expect(projectCapacity({ remainingForKey: 1, openCloudAttempts: 0, autofixDispatchesToday: 0, autofixMaxPerDay: 30 })).toBe(1)
    expect(projectCapacity({ remainingForKey: 5, openCloudAttempts: 4, autofixDispatchesToday: 0, autofixMaxPerDay: null })).toBe(0)
  })
})

function seed(extra: Record<string, unknown[]> = {}) {
  return makeFakeDb(
    {
      projects: [
        { id: P1, organization_id: ORG },
        { id: P2, organization_id: ORG },
      ],
      project_settings: [
        { project_id: P1, autofix_enabled: true, autofix_max_dispatches_per_day: 30 },
        { project_id: P2, autofix_enabled: true, autofix_max_dispatches_per_day: 30 },
      ],
      project_repos: [{ project_id: P1 }, { project_id: P2 }],
      byok_keys: [
        { ...key(), vault_secret_id: 'v', priority: 100, test_status: 'ok' },
        { id: 'own', provider_slug: 'cursor', status: 'active', test_status: 'ok', priority: 100, project_id: P2, organization_id: null },
      ],
      reports: [
        { id: 'r1', project_id: P1, status: 'classified', severity: 'high', judge_score: 0.8, component: 'a.ts', report_group_id: null, created_at: '2026-10-19T00:00:00Z' },
        { id: 'r2', project_id: P1, status: 'classified', severity: 'medium', judge_score: 0.7, component: null, report_group_id: null, created_at: '2026-10-18T00:00:00Z' },
        { id: 'r3', project_id: P1, status: 'fixed', severity: 'critical', judge_score: 0.9, component: 'b.ts', report_group_id: null, created_at: '2026-10-19T00:00:00Z' },
        { id: 'r4', project_id: P1, status: 'classified', severity: 'critical', judge_score: 0.9, component: 'c.ts', report_group_id: null, created_at: '2026-10-19T00:00:00Z' },
        { id: 'p2r', project_id: P2, status: 'classified', severity: 'critical', judge_score: 0.9, component: 'd.ts', report_group_id: null, created_at: '2026-10-19T00:00:00Z' },
      ],
      fix_dispatch_jobs: [{ id: 'old', project_id: P1, report_id: 'r4', status: 'failed', created_at: '2026-10-17T00:00:00Z', dispatch_metadata: {} }],
      fix_attempts: [],
      ...extra,
    },
    { autoId: true },
  )
}

const allowAll = async () => ({ allowed: true, dispatchesToday: 0, maxDispatchesPerDay: 30 }) as never

describe('runSpendDownForKey', () => {
  it('dispatches the best open reports of the apps the key serves, as automatic cursor_cloud fixes', async () => {
    const db = seed()
    const calls: Array<Record<string, unknown>> = []
    const summary = await worker.runSpendDownForKey(db as never, key(), {
      now: NOW,
      checkBudget: allowAll,
      dispatch: async (input) => {
        calls.push(input as never)
        return { ok: true }
      },
    })
    // r4 was dispatched 3 days ago (cooldown), r3 is fixed, P2 has its own key.
    expect(calls.map((c) => c.reportId)).toEqual(['r1', 'r2'])
    expect(calls[0]).toMatchObject({
      projectId: P1,
      trigger: 'automatic',
      skipMembershipCheck: true,
      metadata: {
        source: 'spend_down',
        agent_override: 'cursor_cloud',
        spend_down_key_id: 'k1',
        model_override: 'grok-4.7?reasoning_effort=xhigh&context=500k',
      },
    })
    expect(summary).toMatchObject({ state: 'active', dispatched: 2, remainingToday: 8 })
  })

  it('never picks a report whose last run the agent settled as already fixed or wrong repo', async () => {
    const db = seed({
      fix_attempts: [{ id: 'fa', project_id: P1, report_id: 'r1', agent: 'cursor_cloud', status: 'failed', failure_category: 'already_fixed', created_at: '2026-10-01T00:00:00Z' }],
    })
    const calls: Array<Record<string, unknown>> = []
    await worker.runSpendDownForKey(db as never, key(), {
      now: NOW,
      checkBudget: allowAll,
      dispatch: async (i) => (calls.push(i as never), { ok: true }),
    })
    expect(calls.map((c) => c.reportId)).toEqual(['r2'])
  })

  it('stops at the daily limit, counting what it already started today', async () => {
    const db = seed({
      fix_dispatch_jobs: [
        { id: 'd1', project_id: P1, report_id: 'x', status: 'running', created_at: '2026-10-20T01:00:00Z', dispatch_metadata: { spend_down_key_id: 'k1' } },
      ],
    })
    const calls: unknown[] = []
    const summary = await worker.runSpendDownForKey(db as never, key({ spend_down_daily_limit: 2 }), {
      now: NOW,
      checkBudget: allowAll,
      dispatch: async (i) => (calls.push(i), { ok: true }),
    })
    expect(calls).toHaveLength(1)
    expect(summary).toMatchObject({ dispatchedToday: 2, remainingToday: 0 })
  })

  it('respects the auto-fix cap and the 3-running bound', async () => {
    const capped = await worker.runSpendDownForKey(seed() as never, key(), {
      now: NOW,
      checkBudget: async () => ({ allowed: false, reason: 'Daily auto-fix dispatch quota reached (3/3).' }) as never,
      dispatch: async () => ({ ok: true }),
    })
    expect(capped.dispatched).toBe(0)
    expect(capped.projects[0]).toMatchObject({ projectId: P1, stopped: expect.stringContaining('quota') })

    const running = Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, project_id: P1, agent: 'cursor_cloud', status: 'running' }))
    const busy = await worker.runSpendDownForKey(seed({ fix_attempts: running }) as never, key(), {
      now: NOW,
      checkBudget: allowAll,
      dispatch: async () => ({ ok: true }),
    })
    expect(busy.dispatched).toBe(0)
    expect(busy.projects[0].stopped).toBe('Three fixes already running')
  })

  it('does nothing outside the window', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }))
    const s = await worker.runSpendDownForKey(seed() as never, key({ credits_expire_at: '2027-01-01T00:00:00Z' }), { now: NOW, dispatch })
    expect(s.state).toBe('not_started')
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('runSpendDownForKey and legacy keys', () => {
  it("skips an app whose legacy Integrations key comes before the shared key (ADR 0023)", async () => {
    const db = seed({
      project_settings: [
        { project_id: P1, autofix_enabled: true, autofix_max_dispatches_per_day: 30, cursor_api_key_ref: 'vault://legacy' },
        { project_id: P2, autofix_enabled: true, autofix_max_dispatches_per_day: 30 },
      ],
      byok_keys: [{ ...key(), vault_secret_id: 'v', priority: 100, test_status: 'ok' }],
    })
    const calls: Array<Record<string, unknown>> = []
    await worker.runSpendDownForKey(db as never, key(), {
      now: NOW,
      checkBudget: allowAll,
      dispatch: async (i) => (calls.push(i as never), { ok: true }),
    })
    expect(calls.map((c) => c.projectId)).toEqual([P2])
  })
})

describe('runSpendDown', () => {
  it('runs every enabled Cursor key and stores its summary on the key', async () => {
    const db = seed()
    const out = await worker.runSpendDown(db as never, { now: NOW, checkBudget: allowAll, dispatch: async () => ({ ok: true }) })
    expect(out).toHaveLength(1)
    const stored = db.table('byok_keys').find((k: Record<string, unknown>) => k.id === 'k1') as Record<string, unknown>
    expect(stored.spend_down_last_run_at).toBe(NOW.toISOString())
    expect((stored.spend_down_last_summary as { dispatched: number }).dispatched).toBe(2)
  })
})

describe('spendDownDispatchMetadata', () => {
  it('leaves the model to the app default when the key has none', () => {
    expect(spendDownDispatchMetadata({ id: 'k', spend_down_model: null })).toEqual({
      source: 'spend_down',
      agent_override: 'cursor_cloud',
      spend_down_key_id: 'k',
    })
  })
})
