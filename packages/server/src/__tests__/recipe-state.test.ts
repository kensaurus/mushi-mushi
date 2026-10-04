/**
 * deriveElementState (Plan 019 decision 4): every element, every branch, and
 * above all every "never checked" path, which must come out `unknown` or
 * `not_connected` and never `ok`.
 */
import { describe, expect, it } from 'vitest'
import {
  cadenceDays,
  deriveElementState,
  gateLabel,
  guardNeverChecked,
  isStale,
  worstState,
  type ElementInput,
} from '../../supabase/functions/_shared/recipe-state.ts'

const NOW = new Date('2026-10-02T12:00:00Z')
const HOUR_AGO = '2026-10-02T11:00:00Z'
const TEN_DAYS_AGO = '2026-09-22T12:00:00Z'
const state = (i: ElementInput) => deriveElementState(i, NOW).state

describe('helpers', () => {
  it('isStale treats null and garbage as stale', () => {
    expect(isStale(null, NOW, 1)).toBe(true)
    expect(isStale('not a date', NOW, 1)).toBe(true)
    expect(isStale(HOUR_AGO, NOW, 1)).toBe(false)
    expect(isStale(TEN_DAYS_AGO, NOW, 7)).toBe(true)
  })
  it('cadenceDays reads P<n>D and falls back otherwise', () => {
    expect(cadenceDays('P1D', 7)).toBe(1)
    expect(cadenceDays('PT1H', 7)).toBe(7)
    expect(cadenceDays(undefined, 3)).toBe(3)
  })
  it('worstState orders error > drift > unknown > not_connected > ok; empty is unknown', () => {
    expect(worstState(['ok', 'not_connected', 'unknown', 'drift', 'error'])).toBe('error')
    expect(worstState(['ok', 'unknown'])).toBe('unknown')
    expect(worstState(['ok', 'not_connected'])).toBe('not_connected')
    expect(worstState(['ok'])).toBe('ok')
    expect(worstState([])).toBe('unknown')
  })
})

describe('schema', () => {
  const base = { key: 'schema' as const, linked: true, latestSnapshotAt: HOUR_AGO, openDriftFindings: 0, lastRunStatus: 'pass' }
  it('not linked and never scanned is not_connected', () => {
    expect(state({ ...base, linked: false, latestSnapshotAt: null })).toBe('not_connected')
  })
  it('linked but no snapshot is unknown, never ok (0 rows in production today)', () => {
    expect(state({ ...base, latestSnapshotAt: null, lastRunStatus: null })).toBe('unknown')
  })
  it('a failed scan is error', () => expect(state({ ...base, lastRunStatus: 'error' })).toBe('error'))
  it('an old snapshot is unknown', () => expect(state({ ...base, latestSnapshotAt: TEN_DAYS_AGO })).toBe('unknown'))
  it('open findings are drift', () => expect(state({ ...base, openDriftFindings: 2 })).toBe('drift'))
  it('fresh and clean is ok', () => expect(state(base)).toBe('ok'))
})

describe('design', () => {
  const base = {
    key: 'design' as const,
    repoConnected: true,
    tokenAvailable: true,
    snapshotAt: HOUR_AGO,
    manifestPresent: true,
    manifestErrors: 0,
    tokenCount: 87,
    lastError: null,
    runAt: HOUR_AGO,
    runStatus: 'pass' as const,
    openFindings: 0,
    score: 4,
  }
  it('tokens read but no design check yet never starts "Not checked yet" (the card has a check time: the token read)', () => {
    const r = deriveElementState({ ...base, runAt: null, runStatus: null }, NOW)
    expect(r.state).toBe('unknown')
    expect(r.reason).not.toMatch(/^Not checked/)
    expect(r.reason).toMatch(/design check has not run yet/)
  })
  it('no repo / no token is not_connected', () => {
    expect(state({ ...base, repoConnected: false })).toBe('not_connected')
    expect(state({ ...base, tokenAvailable: false })).toBe('not_connected')
  })
  it('never read is unknown; a failed first read is error', () => {
    expect(state({ ...base, snapshotAt: null, manifestPresent: null, runAt: null, runStatus: null })).toBe('unknown')
    expect(state({ ...base, snapshotAt: null, manifestPresent: null, lastError: { at: HOUR_AGO, message: 'boom' } })).toBe('error')
  })
  it('no manifest is not_connected; a rejected manifest is error', () => {
    expect(state({ ...base, manifestPresent: false })).toBe('not_connected')
    expect(state({ ...base, manifestPresent: false, manifestErrors: 1 })).toBe('error')
  })
  it('a manifest with no readable tokens is not_connected', () => expect(state({ ...base, tokenCount: 0 })).toBe('not_connected'))
  it('a refresh error newer than the snapshot is error', () => {
    expect(state({ ...base, snapshotAt: TEN_DAYS_AGO, lastError: { at: HOUR_AGO, message: 'token revoked' } })).toBe('error')
  })
  it('tokens but no scan yet is unknown, never ok', () => {
    expect(state({ ...base, runAt: null, runStatus: null, score: null })).toBe('unknown')
  })
  it('a running scan is unknown; a failed scan is error', () => {
    expect(state({ ...base, runStatus: 'running' })).toBe('unknown')
    expect(state({ ...base, runStatus: 'error' })).toBe('error')
  })
  it('an old scan is unknown', () => expect(state({ ...base, runAt: TEN_DAYS_AGO })).toBe('unknown'))
  it('a scan that scored nothing is unknown', () => expect(state({ ...base, score: null })).toBe('unknown'))
  it('open findings are drift; clean is ok', () => {
    expect(state({ ...base, openFindings: 3, runStatus: 'warn' })).toBe('drift')
    expect(state(base)).toBe('ok')
  })
})

describe('routes', () => {
  const base = { key: 'routes' as const, hasInventory: true, graphNodes: 184, validationErrors: 0, lastGateRunAt: HOUR_AGO, openFindings: 0 }
  it('nothing declared or observed is not_connected', () => expect(state({ ...base, hasInventory: false, graphNodes: 0 })).toBe('not_connected'))
  it('validation errors are drift', () => expect(state({ ...base, validationErrors: 1 })).toBe('drift'))
  it('no gate run is unknown', () => expect(state({ ...base, lastGateRunAt: null })).toBe('unknown'))
  it('an old gate run is unknown', () => expect(state({ ...base, lastGateRunAt: '2026-09-01T00:00:00Z' })).toBe('unknown'))
  it('open findings are drift; clean is ok', () => {
    expect(state({ ...base, openFindings: 1 })).toBe('drift')
    expect(state(base)).toBe('ok')
  })
})

describe('gates', () => {
  const run = (over: Partial<{ gate: string; status: string; completedAt: string | null; openFindings: number }> = {}) => ({ gate: 'code_health', status: 'pass', completedAt: HOUR_AGO, openFindings: 0, ...over })
  it('no runs is not_connected', () => expect(state({ key: 'gates', runs: [], cadenceDays: 7 })).toBe('not_connected'))
  it('an errored run is error', () => expect(state({ key: 'gates', runs: [run({ status: 'error' })], cadenceDays: 7 })).toBe('error'))
  it('open findings are drift', () => expect(state({ key: 'gates', runs: [run({ openFindings: 2 })], cadenceDays: 7 })).toBe('drift'))
  it('every run older than the cadence is unknown (stale gate)', () => {
    expect(state({ key: 'gates', runs: [run({ completedAt: TEN_DAYS_AGO })], cadenceDays: 7 })).toBe('unknown')
  })
  it('one stale gate among fresh ones is unknown', () => {
    expect(state({ key: 'gates', runs: [run(), run({ gate: 'crawl', completedAt: TEN_DAYS_AGO })], cadenceDays: 1 })).toBe('unknown')
  })
  it('a run with no completion time counts as stale', () => {
    expect(state({ key: 'gates', runs: [run({ completedAt: null })], cadenceDays: 7 })).toBe('unknown')
  })
  it('fresh and clean is ok', () => expect(state({ key: 'gates', runs: [run()], cadenceDays: 7 })).toBe('ok'))
  it('drift names each check with open problems in plain words, never a raw gate id', () => {
    const r = deriveElementState({ key: 'gates', runs: [run({ gate: 'radar', openFindings: 1 }), run({ gate: 'code_health', openFindings: 9 }), run({ gate: 'crawl' })], cadenceDays: 7 }, NOW)
    expect(r.state).toBe('drift')
    expect(r.reason).toBe('10 problems to fix: Mushi setup check (1), Code health (9). Mushi setup checks and their fixes are under Risk checks on the Recipe page; the rest are in Full-stack audit.')
    // Only Mushi's setup check open (every live app on 2026-10-04): point at where its one-click fix is.
    const setupOnly = deriveElementState({ key: 'gates', runs: [run({ gate: 'radar', openFindings: 1 })], cadenceDays: 7 }, NOW)
    expect(setupOnly.reason).toBe('1 problem to fix: Mushi setup check (1). They and their fixes are under Risk checks on the Recipe page.')
  })
  it('gateLabel reads the gate catalog and falls back to the id', () => {
    expect(gateLabel('radar')).toBe('Mushi setup check')
    expect(gateLabel('constructor')).toBe('constructor')
  })
})

describe('ci', () => {
  const base = { key: 'ci' as const, repoConnected: true, tokenAvailable: true, fetchError: null, run: { status: 'completed', conclusion: 'success', updatedAt: HOUR_AGO, name: 'CI' } }
  it('no repo / no token is not_connected', () => {
    expect(state({ ...base, repoConnected: false })).toBe('not_connected')
    expect(state({ ...base, tokenAvailable: false })).toBe('not_connected')
  })
  it('a failed read is error, not unknown and not ok', () => expect(state({ ...base, fetchError: '403' })).toBe('error'))
  it('no run for the head commit is unknown', () => expect(state({ ...base, run: null })).toBe('unknown'))
  it('in-progress is unknown', () => expect(state({ ...base, run: { ...base.run, status: 'in_progress', conclusion: null } })).toBe('unknown'))
  it('skipped or neutral is unknown', () => {
    expect(state({ ...base, run: { ...base.run, conclusion: 'skipped' } })).toBe('unknown')
    expect(state({ ...base, run: { ...base.run, conclusion: 'neutral' } })).toBe('unknown')
  })
  it('a failure is drift; success is ok', () => {
    expect(state({ ...base, run: { ...base.run, conclusion: 'failure' } })).toBe('drift')
    expect(state(base)).toBe('ok')
  })
})

describe('deploy', () => {
  it('no releases and no versions is not_connected', () => expect(state({ key: 'deploy', releaseCount: 0, appVersions: [] })).toBe('not_connected'))
  it('without a deploy probe it is always unknown, even with releases (all 50 deploy_status rows are unknown today)', () => {
    expect(state({ key: 'deploy', releaseCount: 3, appVersions: ['web 1.42'] })).toBe('unknown')
    expect(deriveElementState({ key: 'deploy', releaseCount: 3, appVersions: [] }, NOW).reason).toMatch(/No deploy target is declared/)
  })
})

describe('env', () => {
  const base = { key: 'env' as const, repoConnected: true, tokenAvailable: true, fetchError: null, required: ['A', 'B'], missing: [] as string[] | null }
  it('no repo / no token is not_connected', () => {
    expect(state({ ...base, repoConnected: false })).toBe('not_connected')
    expect(state({ ...base, tokenAvailable: false })).toBe('not_connected')
  })
  it('a 403 listing names is error, never "everything missing"', () => expect(state({ ...base, fetchError: 'cannot list', missing: null })).toBe('error'))
  it('never listed is unknown', () => expect(state({ ...base, missing: null })).toBe('unknown'))
  it('missing names are drift; none missing is ok', () => {
    expect(state({ ...base, missing: ['B'] })).toBe('drift')
    expect(state(base)).toBe('ok')
  })
})

describe('integrations', () => {
  it('none configured is not_connected', () => expect(state({ key: 'integrations', configured: [] })).toBe('not_connected'))
  it('configured but never health-checked is unknown', () => {
    expect(state({ key: 'integrations', configured: [{ kind: 'sentry', health: null, checkedAt: null }] })).toBe('unknown')
    expect(state({ key: 'integrations', configured: [{ kind: 'sentry', health: 'unknown', checkedAt: HOUR_AGO }] })).toBe('unknown')
  })
  it('"never checked" names only what has no check; a checked-but-inconclusive one says so instead', () => {
    const never = deriveElementState({ key: 'integrations', configured: [{ kind: 'sentry', health: 'ok', checkedAt: HOUR_AGO }, { kind: 'slack', health: null, checkedAt: null }] }, NOW)
    expect(never).toEqual({ state: 'unknown', reason: 'Not checked yet: slack. Run a check from Integrations.' })
    const unclear = deriveElementState({ key: 'integrations', configured: [{ kind: 'sentry', health: 'unknown', checkedAt: HOUR_AGO }] }, NOW)
    expect(unclear.reason).toMatch(/^The last check of sentry could not tell/)
    expect(unclear.reason).not.toMatch(/never/i)
  })
  it('down or degraded is drift', () => {
    expect(state({ key: 'integrations', configured: [{ kind: 'slack', health: 'down', checkedAt: HOUR_AGO }] })).toBe('drift')
    expect(state({ key: 'integrations', configured: [{ kind: 'slack', health: 'degraded', checkedAt: HOUR_AGO }] })).toBe('drift')
  })
  it('healthy is ok', () => expect(state({ key: 'integrations', configured: [{ kind: 'slack', health: 'ok', checkedAt: HOUR_AGO }] })).toBe('ok'))
})

describe('guardNeverChecked', () => {
  it('an ok with no check time is "Not checked yet", never a pass', () => {
    expect(guardNeverChecked({ state: 'ok', reason: 'fine' }, null)).toEqual({ state: 'unknown', reason: 'Not checked yet, so this is not a pass.' })
  })
  it('leaves a checked ok and every other state alone', () => {
    expect(guardNeverChecked({ state: 'ok', reason: 'fine' }, HOUR_AGO)).toEqual({ state: 'ok', reason: 'fine' })
    expect(guardNeverChecked({ state: 'drift', reason: 'x' }, null)).toEqual({ state: 'drift', reason: 'x' })
    expect(guardNeverChecked({ state: 'not_connected', reason: 'x' }, null)).toEqual({ state: 'not_connected', reason: 'x' })
  })
})

describe('Phase 2 inputs (deploy probes, ci_drift, env_drift)', () => {
  const now = new Date('2026-10-02T12:00:00Z')
  const fresh = '2026-10-02T06:00:00Z'

  it('declared deploy targets: never probed is unknown, a failed probe is error, drift and ok need a fresh observation', () => {
    const base = { key: 'deploy' as const, releaseCount: 0, appVersions: [], targetsDeclared: 2 }
    expect(deriveElementState({ ...base, observations: [] }, now).state).toBe('unknown')
    expect(deriveElementState({ ...base, observations: [{ targetId: 'web', ok: false, observedAt: fresh, error: 'HTTP 503' }] }, now)).toMatchObject({ state: 'error' })
    expect(deriveElementState({ ...base, observations: [{ targetId: 'web', ok: true, observedAt: '2026-09-20T00:00:00Z', error: null }] }, now).state).toBe('unknown')
    expect(deriveElementState({ ...base, observations: [{ targetId: 'web', ok: true, observedAt: fresh, error: null }], driftFindings: 1 }, now).state).toBe('drift')
    expect(deriveElementState({ ...base, observations: [{ targetId: 'web', ok: true, observedAt: fresh, error: null }], driftFindings: 0 }, now).state).toBe('unknown')
    expect(deriveElementState({ ...base, targetsDeclared: 1, observations: [{ targetId: 'web', ok: true, observedAt: fresh, error: null }], driftFindings: 0 }, now).state).toBe('ok')
  })

  it('a green CI run with open workflow findings is drift, not ok', () => {
    const run = { status: 'completed', conclusion: 'success', updatedAt: fresh, name: 'CI' }
    expect(deriveElementState({ key: 'ci', repoConnected: true, tokenAvailable: true, fetchError: null, run, driftFindings: 2 }, now).state).toBe('drift')
    expect(deriveElementState({ key: 'ci', repoConnected: true, tokenAvailable: true, fetchError: null, run }, now).state).toBe('ok')
  })

  it('each new input, present but with nothing observed, is unknown or not_connected, never ok', () => {
    // ci: findings counted, but no run read yet / repo not connected.
    expect(deriveElementState({ key: 'ci', repoConnected: true, tokenAvailable: true, fetchError: null, run: null, driftFindings: 0 }, now).state).toBe('unknown')
    expect(deriveElementState({ key: 'ci', repoConnected: false, tokenAvailable: false, fetchError: null, run: null, driftFindings: 0 }, now).state).toBe('not_connected')
    // deploy: targets declared, observations absent or empty.
    expect(deriveElementState({ key: 'deploy', releaseCount: 0, appVersions: [], targetsDeclared: 1 }, now).state).toBe('unknown')
    expect(deriveElementState({ key: 'deploy', releaseCount: 0, appVersions: [], targetsDeclared: 1, observations: [], driftFindings: 0 }, now).state).toBe('unknown')
    // env: findings counted, but CI names never listed / repo not connected.
    expect(deriveElementState({ key: 'env', repoConnected: true, tokenAvailable: true, fetchError: null, required: ['A'], missing: null, driftFindings: 0 }, now).state).toBe('unknown')
    expect(deriveElementState({ key: 'env', repoConnected: false, tokenAvailable: false, fetchError: null, required: ['A'], missing: null, driftFindings: 0 }, now).state).toBe('not_connected')
  })

  it('declared env names out of step make env drift even when the Mushi vars are present', () => {
    expect(deriveElementState({ key: 'env', repoConnected: true, tokenAvailable: true, fetchError: null, required: ['A'], missing: [], driftFindings: 1 }, now).state).toBe('drift')
  })
})
