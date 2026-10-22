/**
 * FILE: spend-down.test.ts
 * PURPOSE: Spend-down mode (ADR 0028). The rules in _shared/spend-down.ts,
 *          and the worker on an in-memory database: which apps a key pays
 *          for (ADR 0023), the window, the daily limit, the auto-fix caps,
 *          the 3-running bound, the 7-day re-dispatch cooldown, the 1.3
 *          boost for Sentry or stack evidence, and the dispatch metadata
 *          fix-worker reads (cursor_cloud, model, trigger); the stop-loss
 *          (Wilson-bound entry, 20-sample cold start, hysteresis, daily probe,
 *          probe recovery, 14-day aging, Resume, transition-only log lines,
 *          carry-forward) and the scoreboard rollup.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  cachedYieldSamples,
  type SpendDownYieldCache,
} from '../../supabase/functions/_shared/spend-down-db.ts'
import {
  classifySpendDownRun,
  effectiveStopLossResets,
  firstCursorKeyFor,
  previousPauseStates,
  SPEND_DOWN_MAX_HOLD_RATE,
  SPEND_DOWN_MAX_NO_PR_SHARE,
  SPEND_DOWN_MIN_MERGE_RATE,
  SPEND_DOWN_MIN_SAMPLES,
  SPEND_DOWN_PROBE_RECOVERY,
  SPEND_DOWN_PROBES_PER_DAY,
  SPEND_DOWN_RESUME_HOLD_RATE,
  SPEND_DOWN_RESUME_MERGE_RATE,
  SPEND_DOWN_RESUME_NO_PR_SHARE,
  SPEND_DOWN_SAMPLE_MAX_AGE_DAYS,
  SPEND_DOWN_WILSON_Z,
  SPEND_DOWN_YIELD_WINDOW,
  spendDownScoreboard,
  spendDownStopLoss,
  wilsonInterval,
  type SpendDownPauseState,
  type SpendDownRunRow,
  type SpendDownYieldRun,
  projectCapacity,
  rankSpendDownCandidates,
  reportHasCheapEvidence,
  reportsWithNoRetryVerdict,
  SPEND_DOWN_CANDIDATE_COLUMNS,
  spendDownCandidateFromReport,
  type CursorPoolKey,
  spendDownDispatchMetadata,
  spendDownProjectIds,
  spendDownWindow,
  type SpendDownKey,
} from '../../supabase/functions/_shared/spend-down.ts'

const logLines = vi.hoisted(() => [] as Array<{ msg: string; ctx: Record<string, unknown> }>)
const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) {
    logger[level] = (msg: string, ctx: Record<string, unknown> = {}) => logLines.push({ msg, ctx })
  }
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

  it('boosts Sentry or stack evidence by 1.3 without jumping a severity band', () => {
    const same = { severity: 'high', judge_score: 0.5, component: null, report_group_id: null }
    const ranked = rankSpendDownCandidates([
      { ...same, id: 'plain', created_at: '2026-10-20', has_cheap_evidence: false },
      { ...same, id: 'with-stack', created_at: '2026-10-18', has_cheap_evidence: true },
      { ...same, severity: 'critical', id: 'crit', created_at: '2026-10-17' },
    ])
    // Severity weights: high 3 × 1.3 = 3.9, critical 4. Same judge score, so critical still leads.
    expect(ranked.map((r) => r.id)).toEqual(['crit', 'with-stack', 'plain'])
  })
})

describe('reportHasCheapEvidence', () => {
  it('is true for a Sentry origin, link, event, frame path, or console stack', () => {
    expect(reportHasCheapEvidence({})).toBe(false)
    expect(reportHasCheapEvidence({ source: 'widget', sentry_issue_url: '  ' })).toBe(false)
    expect(reportHasCheapEvidence({ source: 'sentry' })).toBe(true)
    expect(reportHasCheapEvidence({ sentry_issue_url: 'https://sentry.io/issues/1' })).toBe(true)
    expect(reportHasCheapEvidence({ sentry_event_id: 'evt' })).toBe(true)
    expect(reportHasCheapEvidence({ custom_metadata: { sentryFrames: ['', ' src/a.ts '] } })).toBe(true)
    expect(reportHasCheapEvidence({ custom_metadata: { sentryFrames: [] } })).toBe(false)
    expect(reportHasCheapEvidence({ console_logs: [{ level: 'error', message: 'nope' }] })).toBe(false)
    expect(reportHasCheapEvidence({ console_logs: [{ stack: '  at submit (src/pay.ts:10:2)' }] })).toBe(true)
  })

  it('copies the flag onto the candidate the worker ranks', () => {
    expect(SPEND_DOWN_CANDIDATE_COLUMNS).toContain('sentry_issue_url')
    expect(SPEND_DOWN_CANDIDATE_COLUMNS).toContain('console_logs')
    const row = spendDownCandidateFromReport({
      id: 'r',
      severity: 'low',
      judge_score: null,
      component: null,
      report_group_id: null,
      created_at: '2026-10-18',
      console_logs: [{ stack: '  at f (src/a.ts:1:1)' }],
    })
    expect(row.has_cheap_evidence).toBe(true)
    expect(row).not.toHaveProperty('console_logs')
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

  it('dispatches a stacked or Sentry report ahead of an otherwise equal newer one', async () => {
    const base = {
      project_id: P1,
      status: 'classified',
      severity: 'high',
      judge_score: 0.8,
      component: 'a.ts',
      report_group_id: null,
      source: 'widget',
    }
    const db = seed({
      reports: [
        { ...base, id: 'newer', created_at: '2026-10-19T00:00:00Z' },
        {
          ...base,
          id: 'stacked',
          created_at: '2026-10-18T00:00:00Z',
          console_logs: [{ level: 'error', stack: '  at submit (src/pay.ts:10:2)' }],
        },
        {
          ...base,
          id: 'sentry',
          created_at: '2026-10-17T00:00:00Z',
          sentry_issue_url: 'https://acme.sentry.io/issues/1/',
        },
      ],
      fix_dispatch_jobs: [],
    })
    const calls: Array<Record<string, unknown>> = []
    await worker.runSpendDownForKey(db as never, key(), {
      now: NOW,
      checkBudget: allowAll,
      dispatch: async (input) => {
        calls.push(input as never)
        return { ok: true }
      },
    })
    expect(calls.map((c) => c.reportId)).toEqual(['stacked', 'sentry', 'newer'])
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

describe('stop-loss constants', () => {
  it('are the documented values', () => {
    expect(SPEND_DOWN_SAMPLE_MAX_AGE_DAYS).toBe(14)
    expect(SPEND_DOWN_YIELD_WINDOW).toBe(40)
    expect(SPEND_DOWN_MIN_SAMPLES).toBe(20)
    expect(SPEND_DOWN_WILSON_Z).toBe(1.645)
    expect([SPEND_DOWN_MIN_MERGE_RATE, SPEND_DOWN_MAX_HOLD_RATE, SPEND_DOWN_MAX_NO_PR_SHARE]).toEqual([0.2, 0.35, 0.5])
    expect([SPEND_DOWN_RESUME_MERGE_RATE, SPEND_DOWN_RESUME_HOLD_RATE, SPEND_DOWN_RESUME_NO_PR_SHARE]).toEqual([0.25, 0.3, 0.45])
    expect([SPEND_DOWN_PROBES_PER_DAY, SPEND_DOWN_PROBE_RECOVERY]).toEqual([1, 2])
  })
})

describe('wilsonInterval (one-sided 95%)', () => {
  it('separates 1 in 20 from 2 in 20 at the 20% line', () => {
    expect(wilsonInterval(1, 20).upper).toBeLessThan(0.2)
    expect(wilsonInterval(1, 20).upper).toBeCloseTo(0.196, 3)
    expect(wilsonInterval(2, 20).upper).toBeGreaterThan(0.2)
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 1 })
  })
})

const T0 = Date.parse('2026-10-19T00:00:00Z')
/**
 * Runs newest first, one minute apart: `reviews` lists PR verdicts, `noPr`
 * no-PR verdict runs, `other` other failures, `inFlight` open runs.
 */
function sample(spec: {
  merge?: number
  hold?: number
  fixFirst?: number
  noPr?: number
  other?: number
  inFlight?: number
  probe?: boolean
  startMin?: number
}): SpendDownYieldRun[] {
  const out: SpendDownYieldRun[] = []
  let i = spec.startMin ?? 0
  const push = (outcome: SpendDownYieldRun['outcome'], verdict: string | null) => {
    const at = new Date(T0 - i++ * 60_000).toISOString()
    out.push({ at, outcome, verdict, reviewedAt: verdict ? at : null, probe: spec.probe ?? false })
  }
  for (let n = 0; n < (spec.inFlight ?? 0); n++) push('in_flight', null)
  for (let n = 0; n < (spec.merge ?? 0); n++) push('pr_opened', 'merge')
  for (let n = 0; n < (spec.hold ?? 0); n++) push('pr_opened', 'hold')
  for (let n = 0; n < (spec.fixFirst ?? 0); n++) push('pr_opened', 'fix_first')
  for (let n = 0; n < (spec.noPr ?? 0); n++) push('no_pr_verdict', null)
  for (let n = 0; n < (spec.other ?? 0); n++) push('other_failure', null)
  return out
}
const PAUSED: SpendDownPauseState = { paused: true, pausedAt: '2026-10-19T12:00:00.000Z' }
const AT = new Date('2026-10-20T09:00:00Z')

describe('spendDownStopLoss: entry', () => {
  it('does NOT pause an average app (the 2026-10-21 baseline: 29% merge, 22% hold, 25% no-PR)', () => {
    // 40 reviews: 12 merge (30%), 9 hold (22.5%); 40 finished runs incl. 10 no-PR (25%).
    const d = spendDownStopLoss({ runs: sample({ merge: 12, hold: 9, fixFirst: 19, noPr: 10 }) }, undefined, AT)
    expect(d).toMatchObject({ paused: false, transition: null, reviewed: 40, finishedRuns: 40 })
  })

  it('does NOT pause a below-average but plausible app (glot.it: 23% merge)', () => {
    expect(spendDownStopLoss({ runs: sample({ merge: 9, hold: 8, fixFirst: 23, noPr: 10 }) }, undefined, AT).paused).toBe(false)
  })

  it('pauses a clearly bad app (1 of 20 mergeable), in plain words', () => {
    const d = spendDownStopLoss({ runs: sample({ merge: 1, fixFirst: 19 }) }, undefined, AT)
    expect(d).toMatchObject({
      paused: true,
      transition: 'paused',
      pausedAt: AT.toISOString(),
      reason: 'Paused: 1 of the last 20 reviewed fixes were mergeable (5%)',
    })
    expect(d.mergeUpper).toBeLessThan(0.2)
  })

  it('does not pause 2 of 20 mergeable: not reliably under 20% yet', () => {
    expect(spendDownStopLoss({ runs: sample({ merge: 2, fixFirst: 18 }) }, undefined, AT).paused).toBe(false)
  })

  it('needs 20 samples for every rule (cold start)', () => {
    expect(spendDownStopLoss({ runs: sample({ hold: 19 }) }, undefined, AT)).toMatchObject({ paused: false, mergeUpper: null })
    expect(spendDownStopLoss({ runs: sample({ noPr: 19 }) }, undefined, AT)).toMatchObject({ paused: false, noPrLower: null })
    expect(spendDownStopLoss({ runs: sample({ fixFirst: 20 }) }, undefined, AT).paused).toBe(true)
  })

  it('hold: 11 of 20 pauses (lower bound over 35%), 10 of 20 does not', () => {
    const d = spendDownStopLoss({ runs: sample({ merge: 6, hold: 11, fixFirst: 3 }) }, undefined, AT)
    expect(d.reason).toBe('Paused: Opus said hold on 11 of the last 20 reviewed fixes (55%)')
    expect(spendDownStopLoss({ runs: sample({ merge: 6, hold: 10, fixFirst: 4 }) }, undefined, AT).paused).toBe(false)
  })

  it('no-PR: 14 of 20 finished runs pauses, 13 does not; in-flight runs are not samples', () => {
    const d = spendDownStopLoss({ runs: sample({ inFlight: 5, merge: 6, noPr: 14 }) }, undefined, AT)
    expect(d.finishedRuns).toBe(20)
    expect(d.reason).toContain('the agent opened no PR on 14 of the last 20 runs (70%)')
    expect(spendDownStopLoss({ runs: sample({ merge: 7, noPr: 13 }) }, undefined, AT).paused).toBe(false)
  })

  it('reads the newest 40, so older bad runs fall out of the window', () => {
    const runs = [...sample({ merge: 12, fixFirst: 28 }), ...sample({ fixFirst: 40, startMin: 100 })]
    expect(spendDownStopLoss({ runs }, undefined, AT)).toMatchObject({ paused: false, reviewed: 40, mergeVerdicts: 12 })
  })

  it('orders reviews by when they were reviewed, not dispatched', () => {
    // 40 bad reviews dispatched recently but reviewed long ago, and 40 good
    // ones dispatched earlier but reviewed just now: the good ones are newest.
    const bad = sample({ fixFirst: 40 }).map((r) => ({ ...r, reviewedAt: '2026-10-10T00:00:00.000Z' }))
    const good = sample({ merge: 20, fixFirst: 20, startMin: 100 }).map((r) => ({ ...r, reviewedAt: '2026-10-19T23:00:00.000Z' }))
    expect(spendDownStopLoss({ runs: [...bad, ...good] }, undefined, AT)).toMatchObject({ paused: false, mergeVerdicts: 20 })
  })
})

describe('spendDownStopLoss: while paused (hysteresis, probes, aging out)', () => {
  it('stays paused at exactly 25% merge and resumes above it', () => {
    const held = spendDownStopLoss({ runs: sample({ merge: 5, fixFirst: 15 }) }, PAUSED, AT)
    expect(held).toMatchObject({ paused: true, transition: null, pausedAt: PAUSED.pausedAt })
    expect(held.reason).toBe('Paused: 5 of the last 20 reviewed fixes were mergeable (25%), resumes above 25%')
    expect(spendDownStopLoss({ runs: sample({ merge: 6, fixFirst: 14 }) }, PAUSED, AT)).toMatchObject({
      paused: false,
      transition: 'resumed',
      resumedBy: 'rates',
    })
  })

  it('a not-paused app at 25% stays running: entry needs the bound, not the point estimate', () => {
    expect(spendDownStopLoss({ runs: sample({ merge: 5, fixFirst: 15 }) }, undefined, AT).paused).toBe(false)
  })

  it('stays paused at 30% hold or 45% no-PR', () => {
    expect(spendDownStopLoss({ runs: sample({ merge: 8, hold: 6, fixFirst: 6 }) }, PAUSED, AT).paused).toBe(true)
    expect(spendDownStopLoss({ runs: sample({ merge: 8, hold: 5, fixFirst: 7 }) }, PAUSED, AT).paused).toBe(false)
    expect(spendDownStopLoss({ runs: sample({ merge: 11, noPr: 9 }) }, PAUSED, AT).paused).toBe(true)
  })

  it('resumes when the old samples age out (under 20 left)', () => {
    expect(spendDownStopLoss({ runs: sample({ fixFirst: 5 }) }, PAUSED, AT)).toMatchObject({
      paused: false,
      transition: 'resumed',
      resumedBy: 'samples_aged_out',
    })
  })

  it('resumes when the newest 2 reviewed probes since the pause both got merge', () => {
    // Window still bad (2 merges in 40), but both probes after the pause merged.
    const probes = sample({ merge: 2, probe: true }).map((r, i) => ({
      ...r,
      at: `2026-10-20T0${i}:00:00.000Z`,
      reviewedAt: `2026-10-20T0${i}:30:00.000Z`,
    }))
    const runs = [...probes, ...sample({ fixFirst: 38, startMin: 10 })]
    // The resume restarts the window at the older resuming probe's dispatch.
    expect(spendDownStopLoss({ runs }, PAUSED, AT)).toMatchObject({
      paused: false,
      resumedBy: 'probes',
      resetAt: '2026-10-20T00:00:00.000Z',
    })
    // One merged probe is not enough; probes from before the pause do not count.
    expect(spendDownStopLoss({ runs: [probes[0], ...sample({ fixFirst: 39, startMin: 10 })] }, PAUSED, AT).paused).toBe(true)
    const early = probes.map((r) => ({ ...r, at: '2026-10-19T01:00:00.000Z' }))
    expect(spendDownStopLoss({ runs: [...early, ...sample({ fixFirst: 38, startMin: 10 })] }, PAUSED, AT).paused).toBe(true)
  })
})

describe('classifySpendDownRun', () => {
  it('sorts a run into PR, no-PR verdict, in flight or other failure', () => {
    const pr = 'https://github.com/a/b/pull/1'
    expect(classifySpendDownRun({ status: 'completed' }, { status: 'completed', pr_url: pr })).toBe('pr_opened')
    expect(classifySpendDownRun({ status: 'skipped' }, { status: 'failed', failure_category: 'needs_human' })).toBe('no_pr_verdict')
    expect(classifySpendDownRun({ status: 'completed' }, { status: 'running' })).toBe('in_flight')
    expect(classifySpendDownRun({ status: 'queued' }, null)).toBe('in_flight')
    expect(classifySpendDownRun({ status: 'completed_no_pr' }, { status: 'failed', failure_category: 'cursor_api_error' })).toBe(
      'other_failure',
    )
    expect(classifySpendDownRun({ status: 'failed' }, null)).toBe('other_failure')
  })

  it('a draft PR attached to a running attempt is still in flight (attachPendingPr)', () => {
    expect(classifySpendDownRun({ status: 'completed' }, { status: 'running', pr_url: 'https://github.com/a/b/pull/2' })).toBe('in_flight')
  })

  it('a notes-only PR (validation_rejected) is not a PR opened', () => {
    const pr = 'https://github.com/a/b/pull/3'
    expect(
      classifySpendDownRun({ status: 'completed_no_pr', pr_url: pr }, { status: 'failed', pr_url: pr, failure_category: 'validation_rejected' }),
    ).toBe('other_failure')
  })
})

describe('effectiveStopLossResets', () => {
  it('takes the later of the console Resume and the reset carried in the summary', () => {
    const summary = {
      projects: [
        { projectId: 'a', stopLossResetAt: '2026-10-20T00:00:00Z' },
        { projectId: 'b', stopLossResetAt: '2026-10-18T00:00:00Z' },
        { projectId: 'c' },
      ],
    }
    const db = new Map([
      ['a', '2026-10-19T00:00:00Z'],
      ['b', '2026-10-19T00:00:00Z'],
    ])
    expect([...effectiveStopLossResets(db, summary).entries()]).toEqual([
      ['a', '2026-10-20T00:00:00Z'],
      ['b', '2026-10-19T00:00:00Z'],
    ])
    expect(effectiveStopLossResets(new Map(), null).size).toBe(0)
  })
})

describe('previousPauseStates', () => {
  const summary = {
    projects: [
      { projectId: 'a', paused: true, pausedAt: '2026-10-19T00:00:00Z', stopped: 'Paused: x' },
      { projectId: 'b', paused: true, pausedAt: '2026-10-19T00:00:00Z' },
      { projectId: 'c' },
    ],
  }
  it('reads the paused apps with when and why, and tolerates junk', () => {
    expect([...previousPauseStates(summary).entries()]).toEqual([
      ['a', { paused: true, pausedAt: '2026-10-19T00:00:00Z', reason: 'Paused: x' }],
      ['b', { paused: true, pausedAt: '2026-10-19T00:00:00Z', reason: null }],
    ])
    expect(previousPauseStates(null).size).toBe(0)
    expect(previousPauseStates({ projects: 'x' }).size).toBe(0)
  })
  it('drops a pause that began before the app was resumed by hand', () => {
    const resets = new Map([
      ['a', '2026-10-19T06:00:00Z'],
      ['b', '2026-10-18T00:00:00Z'],
    ])
    expect([...previousPauseStates(summary, resets).keys()]).toEqual(['b'])
  })
})

describe('spendDownScoreboard', () => {
  const run = (over: Partial<SpendDownRunRow>): SpendDownRunRow => ({
    keyId: 'k1',
    projectId: P1,
    model: 'grok',
    day: '2026-10-20',
    outcome: 'pr_opened',
    noPrVerdict: null,
    verdict: null,
    merged: false,
    latestReviewCostUsd: null,
    ...over,
  })

  it('rolls up per key × app × model × day with yields and the latest review cost per PR', () => {
    const out = spendDownScoreboard([
      run({ verdict: 'merge', merged: true, latestReviewCostUsd: 0.05 }),
      run({ verdict: 'merge', latestReviewCostUsd: 0.0512 }),
      run({ verdict: 'hold', latestReviewCostUsd: Number.NaN }),
      run({ verdict: 'fix_first', latestReviewCostUsd: 0.03 }),
      run({ outcome: 'no_pr_verdict', noPrVerdict: 'needs_human' }),
      run({ outcome: 'other_failure' }),
      run({ outcome: 'in_flight', day: '2026-10-21' }),
      run({ projectId: P2, outcome: 'no_pr_verdict', noPrVerdict: 'already_fixed' }),
      run({ projectId: P2, model: 'other', outcome: 'other_failure' }),
    ])
    expect(out.totals).toMatchObject({
      runs: 9,
      inFlight: 1,
      prsOpened: 4,
      noPrVerdicts: 2,
      otherFailures: 2,
      reviewed: 4,
      verdicts: { merge: 2, fix_first: 1, hold: 1 },
      merged: 1,
      mergeYield: 1 / 9,
      mergeableYield: 2 / 9,
      noPrByVerdict: { needs_human: 1, already_fixed: 1, not_actionable: 0, wrong_repo: 0 },
    })
    // A cost that is not a finite number is skipped, never NaN.
    expect(out.totals.latestReviewCostUsd).toBe(0.1312)
    expect(out.rows.map((r) => [r.day, r.projectId, r.model, r.runs])).toEqual([
      ['2026-10-21', P1, 'grok', 1],
      ['2026-10-20', P1, 'grok', 6],
      ['2026-10-20', P2, 'grok', 1],
      ['2026-10-20', P2, 'other', 1],
    ])
    expect(out.rows[1]).toMatchObject({ prsOpened: 4, mergeableYield: 2 / 6, mergeYield: 1 / 6 })
  })

  it('has null yields and no rows with no runs', () => {
    expect(spendDownScoreboard([])).toMatchObject({
      rows: [],
      totals: { runs: 0, mergeYield: null, mergeableYield: null, latestReviewCostUsd: 0 },
    })
  })
})

/**
 * n spend-down runs on P1 dispatched on 2026-10-19 (inside 14 days, not
 * today), each with a PR: the first `merge` reviewed merge, the next `hold`
 * hold, the rest fix_first.
 */
function yieldRows(n: number, merge: number, hold: number, meta: Record<string, unknown> = {}) {
  const jobs: Record<string, unknown>[] = []
  const attempts: Record<string, unknown>[] = []
  const reviews: Record<string, unknown>[] = []
  for (let i = 0; i < n; i++) {
    const at = new Date(Date.UTC(2026, 9, 19, 12, 59 - i)).toISOString()
    jobs.push({
      id: `sj${i}`,
      project_id: P1,
      report_id: `old${i}`,
      status: 'completed',
      fix_attempt_id: `sa${i}`,
      created_at: at,
      dispatch_metadata: { source: 'spend_down', spend_down_key_id: 'k1', model_override: 'grok', ...meta },
    })
    attempts.push({
      id: `sa${i}`,
      project_id: P1,
      report_id: `old${i}`,
      agent: 'cursor_cloud',
      status: 'completed',
      pr_url: `https://github.com/a/b/pull/${i + 1}`,
      failure_category: null,
      created_at: at,
      merged_at: i === 0 ? at : null,
      llm_model: 'grok-4.7',
    })
    reviews.push({
      id: `sr${i}`,
      fix_attempt_id: `sa${i}`,
      verdict: i < merge ? 'merge' : i < merge + hold ? 'hold' : 'fix_first',
      reviewed_at: at,
      cost_usd: '0.4000',
    })
  }
  return { fix_dispatch_jobs: jobs, fix_attempts: attempts, fix_reviews: reviews }
}

/** A dispatch stub that records calls and writes the job, as fix dispatch does. */
function recordingDispatch(db: { table: (t: string) => Record<string, unknown>[] }, at: () => Date) {
  const calls: Array<Record<string, unknown>> = []
  const fn = async (input: unknown) => {
    const i = input as { projectId: string; reportId: string; metadata: Record<string, unknown> }
    calls.push(i as never)
    db.table('fix_dispatch_jobs').push({
      id: `new${calls.length}-${at().getTime()}`,
      project_id: i.projectId,
      report_id: i.reportId,
      status: 'running',
      fix_attempt_id: null,
      created_at: at().toISOString(),
      dispatch_metadata: i.metadata,
    })
    return { ok: true } as never
  }
  return { calls, fn }
}

describe('runSpendDownForKey stop-loss', () => {
  it('pauses a clearly bad app, logs it once, and still sends it one probe a day', async () => {
    logLines.length = 0
    const db = seed(yieldRows(20, 1, 0))
    const d = recordingDispatch(db, () => NOW)
    const summary = await worker.runSpendDownForKey(db as never, key(), { now: NOW, checkBudget: allowAll, dispatch: d.fn })
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0].metadata).toMatchObject({ source: 'spend_down', spend_down_probe: true })
    expect(summary.projects[0]).toMatchObject({
      projectId: P1,
      dispatched: 1,
      paused: true,
      probe: true,
      pausedAt: NOW.toISOString(),
      stopped: 'Paused: 1 of the last 20 reviewed fixes were mergeable (5%)',
      yield: { reviewed: 20, mergeRate: 0.05, holdRate: 0, finishedRuns: 20, noPrShare: 0 },
    })
    const lines = logLines.filter((l) => l.msg === 'spend-down.paused')
    expect(lines).toHaveLength(1)
    expect(lines[0].ctx).toMatchObject({ keyId: 'k1', projectId: P1, reviewed: 20, mergeRate: 0.05, finishedRuns: 20 })
    expect(lines[0].ctx.mergeUpper as number).toBeLessThan(0.2)
  })

  it('successive ticks: probe, then no second probe the same day and no repeat log, then probe-driven recovery', async () => {
    logLines.length = 0
    let now = NOW
    // 38 old runs with 1 merge: after 2 merged probes the newest 40 hold 3
    // merges (upper bound 0.17), which would pause again without the reset.
    const db = seed(yieldRows(38, 1, 0))
    const d = recordingDispatch(db, () => now)
    const k = key({ spend_down_daily_limit: 50 }) as SpendDownKey & { spend_down_last_summary?: unknown }

    const t1 = await worker.runSpendDownForKey(db as never, k, { now, checkBudget: allowAll, dispatch: d.fn })
    expect(t1.projects[0]).toMatchObject({ paused: true, probe: true, dispatched: 1 })

    now = new Date(NOW.getTime() + 10 * 60_000)
    const t2 = await worker.runSpendDownForKey(db as never, { ...k, spend_down_last_summary: t1 }, { now, checkBudget: allowAll, dispatch: d.fn })
    expect(t2.projects[0]).toMatchObject({ paused: true, dispatched: 0, pausedAt: NOW.toISOString() })
    expect(d.calls).toHaveLength(1)
    expect(logLines.filter((l) => l.msg === 'spend-down.paused')).toHaveLength(1)

    // Next day: the first probe merged, and a second probe (dispatched later) merged too.
    const probe1 = db.table('fix_dispatch_jobs').find((j) => (j.dispatch_metadata as Record<string, unknown>)?.spend_down_probe)!
    Object.assign(probe1, { fix_attempt_id: 'pa1', status: 'completed' })
    db.table('fix_dispatch_jobs').push({
      id: 'probe2',
      project_id: P1,
      report_id: 'x2',
      status: 'completed',
      fix_attempt_id: 'pa2',
      created_at: '2026-10-21T00:30:00.000Z',
      dispatch_metadata: { source: 'spend_down', spend_down_key_id: 'k1', spend_down_probe: true },
    })
    for (const [id, reviewed] of [['pa1', '2026-10-20T12:00:00.000Z'], ['pa2', '2026-10-21T01:00:00.000Z']]) {
      db.table('fix_attempts').push({ id, project_id: P1, report_id: id, agent: 'cursor_cloud', status: 'completed', pr_url: `https://github.com/a/b/pull/${id}` })
      db.table('fix_reviews').push({ fix_attempt_id: id, verdict: 'merge', reviewed_at: reviewed, cost_usd: '0.4' })
    }
    now = new Date('2026-10-21T09:00:00Z')
    const t3 = await worker.runSpendDownForKey(db as never, { ...k, spend_down_last_summary: t2 }, { now, checkBudget: allowAll, dispatch: d.fn })
    expect(t3.projects[0].paused).toBeUndefined()
    expect(t3.projects[0].dispatched).toBeGreaterThan(1)
    expect(logLines.find((l) => l.msg === 'spend-down.resumed')?.ctx).toMatchObject({ projectId: P1, resumedBy: 'probes' })
    // The resume acts as a reset at the first resuming probe's dispatch:
    // stored on the app (service role) and carried in the summary.
    const settings = db.table('project_settings').find((r) => r.project_id === P1)!
    expect(settings.spend_down_stop_loss_reset_at).toBe(NOW.toISOString())
    expect(t3.projects[0].stopLossResetAt).toBe(NOW.toISOString())

    // The tick AFTER the resume: the old window no longer counts, so the app
    // stays running in cold start instead of pausing again. Drop the column
    // value to prove the summary alone holds it (before the migration).
    delete settings.spend_down_stop_loss_reset_at
    logLines.length = 0
    now = new Date('2026-10-21T09:10:00Z')
    const t4 = await worker.runSpendDownForKey(db as never, { ...k, spend_down_last_summary: t3 }, { now, checkBudget: allowAll, dispatch: d.fn })
    expect(t4.projects[0].paused).toBeUndefined()
    expect(t4.projects[0]).toMatchObject({ stopLossResetAt: NOW.toISOString(), yield: { reviewed: 2, mergeRate: 1, mergeUpper: null } })
    // Running, not paused: it only stops because every open report was tried this week.
    expect(t4.projects[0].stopped).toBe('No open report to fix')
    expect(logLines.some((l) => l.msg === 'spend-down.paused')).toBe(false)
  })

  it('keeps pauses and resets while the key is out of its window', async () => {
    const prev = {
      projects: [
        { projectId: P1, dispatched: 0, paused: true, pausedAt: '2026-10-19T13:00:00.000Z', stopped: 'Paused: x', yield: { reviewed: 20 } },
        { projectId: P2, dispatched: 2, stopLossResetAt: '2026-10-19T00:00:00.000Z' },
        { projectId: P3, dispatched: 1 },
      ],
    }
    const dispatch = vi.fn(async () => ({ ok: true }))
    const s = await worker.runSpendDownForKey(
      seed() as never,
      { ...key({ credits_expire_at: '2026-10-20T08:00:00Z' }), spend_down_last_summary: prev },
      { now: NOW, dispatch },
    )
    expect(s.state).toBe('expired')
    expect(dispatch).not.toHaveBeenCalled()
    expect(s.projects).toEqual([
      { projectId: P1, dispatched: 0, paused: true, pausedAt: '2026-10-19T13:00:00.000Z', stopped: 'Paused: x', carried: true },
      { projectId: P2, dispatched: 0, stopLossResetAt: '2026-10-19T00:00:00.000Z', carried: true },
    ])
  })

  it('a Resume (stop_loss_reset_at) ignores the earlier samples and the earlier pause', async () => {
    logLines.length = 0
    const db = seed(yieldRows(20, 1, 0))
    const settings = db.table('project_settings').find((s) => s.project_id === P1)!
    settings.spend_down_stop_loss_reset_at = '2026-10-20T08:00:00.000Z'
    const d = recordingDispatch(db, () => NOW)
    const summary = await worker.runSpendDownForKey(
      db as never,
      { ...key(), spend_down_last_summary: { projects: [{ projectId: P1, paused: true, pausedAt: '2026-10-19T13:00:00.000Z' }] } },
      { now: NOW, checkBudget: allowAll, dispatch: d.fn },
    )
    expect(summary.projects[0]).toMatchObject({ dispatched: 3, yield: { reviewed: 0, finishedRuns: 0 } })
    expect(summary.projects[0].paused).toBeUndefined()
    expect(d.calls.every((c) => !(c.metadata as Record<string, unknown>).spend_down_probe)).toBe(true)
  })

  it('carries a pause forward for an app the tick did not reach', async () => {
    const db = seed({
      fix_dispatch_jobs: [
        { id: 'd1', project_id: P1, report_id: 'x', status: 'running', created_at: '2026-10-20T01:00:00Z', dispatch_metadata: { spend_down_key_id: 'k1' } },
      ],
    })
    const prev = { projects: [{ projectId: P1, paused: true, pausedAt: '2026-10-19T13:00:00.000Z', stopped: 'Paused: x' }] }
    const summary = await worker.runSpendDownForKey(
      db as never,
      { ...key({ spend_down_daily_limit: 1 }), spend_down_last_summary: prev },
      { now: NOW, checkBudget: allowAll, dispatch: async () => ({ ok: true }) },
    )
    expect(summary.projects).toEqual([
      { projectId: P1, dispatched: 0, paused: true, pausedAt: '2026-10-19T13:00:00.000Z', stopped: 'Paused: x', carried: true },
    ])
  })

  it('samples only spend-down runs: manual dispatches on the same app are not evidence', async () => {
    const rows = yieldRows(20, 0, 0)
    rows.fix_dispatch_jobs = rows.fix_dispatch_jobs.map((j) => ({ ...j, dispatch_metadata: { source: 'manual' } }))
    const summary = await worker.runSpendDownForKey(seed(rows) as never, key(), { now: NOW, checkBudget: allowAll, dispatch: async () => ({ ok: true }) })
    expect(summary.projects[0]).toMatchObject({ dispatched: 3, yield: { reviewed: 0 } })
  })

  it("counts another key's spend-down runs on the same app", async () => {
    const summary = await worker.runSpendDownForKey(seed(yieldRows(20, 0, 0, { spend_down_key_id: 'old-key' })) as never, key(), {
      now: NOW,
      checkBudget: allowAll,
      dispatch: async () => ({ ok: true }),
    })
    expect(summary.projects[0]).toMatchObject({ paused: true, yield: { reviewed: 20 } })
  })

  it('ignores runs older than 14 days', async () => {
    const rows = yieldRows(20, 0, 0)
    rows.fix_dispatch_jobs = rows.fix_dispatch_jobs.map((j) => ({ ...j, created_at: '2026-10-05T00:00:00.000Z' }))
    const summary = await worker.runSpendDownForKey(seed(rows) as never, key(), { now: NOW, checkBudget: allowAll, dispatch: async () => ({ ok: true }) })
    expect(summary.projects[0]).toMatchObject({ yield: { reviewed: 0 } })
    expect(summary.projects[0].paused).toBeUndefined()
  })

  it('stays quiet in cold start: 19 held reviews do not pause or log', async () => {
    logLines.length = 0
    const summary = await worker.runSpendDownForKey(seed(yieldRows(19, 0, 19)) as never, key(), {
      now: NOW,
      checkBudget: allowAll,
      dispatch: async () => ({ ok: true }),
    })
    expect(summary.projects[0].paused).toBeUndefined()
    expect(logLines.some((l) => l.msg === 'spend-down.paused' || l.msg === 'spend-down.resumed')).toBe(false)
  })

  it('stores the pause on the key summary, so the next tick knows', async () => {
    const db = seed(yieldRows(20, 0, 10))
    await worker.runSpendDown(db as never, { now: NOW, checkBudget: allowAll, dispatch: async () => ({ ok: true }) })
    const stored = db.table('byok_keys').find((k: Record<string, unknown>) => k.id === 'k1') as Record<string, unknown>
    expect([...previousPauseStates(stored.spend_down_last_summary).keys()]).toEqual([P1])
  })
})

describe('runSpendDown tick lease', () => {
  const run = (db: ReturnType<typeof seed>) =>
    worker.runSpendDown(db as never, { now: NOW, checkBudget: allowAll, dispatch: async () => ({ ok: true }) })
  const k1 = (db: ReturnType<typeof seed>) => db.table('byok_keys').find((k) => k.id === 'k1') as Record<string, unknown>

  it('skips a key another tick holds, and frees the lease after its own tick', async () => {
    logLines.length = 0
    const db = seed()
    k1(db).spend_down_claimed_until = new Date(NOW.getTime() + 60_000).toISOString()
    expect(await run(db)).toEqual([])
    expect(k1(db).spend_down_last_run_at).toBeUndefined()
    expect(logLines.some((l) => l.msg === 'spend-down.key_busy')).toBe(true)

    k1(db).spend_down_claimed_until = new Date(NOW.getTime() - 60_000).toISOString()
    const out = await run(db)
    expect(out).toHaveLength(1)
    expect(k1(db).spend_down_claimed_until).toBeNull()
    expect(k1(db).spend_down_last_run_at).toBe(NOW.toISOString())
  })
})

describe('cachedYieldSamples', () => {
  it('reads an app once per tick', async () => {
    const db = seed(yieldRows(3, 1, 0))
    const from = vi.spyOn(db, 'from')
    const cache: SpendDownYieldCache = new Map()
    const a = await cachedYieldSamples(cache, db as never, P1, NOW, null)
    const b = await cachedYieldSamples(cache, db as never, P1, NOW, null)
    expect(b).toBe(a)
    expect(from.mock.calls.filter(([t]) => t === 'fix_dispatch_jobs')).toHaveLength(1)
  })
})

describe('spendDownStopLoss: a fix that regressed after a Mushi merge counts as a hold (ADR 0035)', () => {
  it('turns one regressed "merge" into the hold that pauses the app', () => {
    const runs = sample({ merge: 6, hold: 10, fixFirst: 4 })
    expect(spendDownStopLoss({ runs }, undefined, AT).paused).toBe(false)
    const regressed = runs.map((r, i) => (i === 0 ? { ...r, regressedAt: '2026-10-19T06:00:00.000Z' } : r))
    const d = spendDownStopLoss({ runs: regressed }, undefined, AT)
    expect(d).toMatchObject({ paused: true, holdVerdicts: 11, mergeVerdicts: 5 })
    expect(d.reason).toMatch(/hold on 11 of the last 20/)
  })

  it('counts a regressed run with no review as a reviewed hold', () => {
    const runs = sample({ merge: 6, hold: 10, fixFirst: 3, other: 1 })
    const last = runs.length - 1
    const regressed = runs.map((r, i) => (i === last ? { ...r, regressedAt: '2026-10-19T06:00:00.000Z' } : r))
    expect(spendDownStopLoss({ runs: regressed }, undefined, AT)).toMatchObject({ reviewed: 20, holdVerdicts: 11, paused: true })
  })

  it('a regressed probe does not count toward probe recovery', () => {
    const probes = sample({ merge: 2, probe: true }).map((r) => ({ ...r, at: '2026-10-20T08:00:00.000Z', reviewedAt: '2026-10-20T08:00:00.000Z' }))
    expect(spendDownStopLoss({ runs: [...probes, ...sample({ merge: 3, fixFirst: 17, startMin: 10 })] }, PAUSED, AT)).toMatchObject({ resumedBy: 'probes' })
    const regressedProbe = probes.map((r, i) => (i === 0 ? { ...r, regressedAt: '2026-10-20T08:30:00.000Z' } : r))
    expect(spendDownStopLoss({ runs: [...regressedProbe, ...sample({ merge: 3, fixFirst: 17, startMin: 10 })] }, PAUSED, AT)).toMatchObject({ paused: true, resumedBy: null })
  })
})
