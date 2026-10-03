/**
 * `_shared/report-deploy-live.ts` — "Fixed — not live yet (prod is on <sha>)"
 * vs "Fixed and live" on the report detail (completeness gap #10).
 *
 * Each target's own commit is placed before or after the merge: a post-merge
 * deploy_drift head means live, a commit from a run that completed before
 * the merge (or one a target ran before the merge) means not live, anything
 * else is unknown. A failed read is `unknown`, never `live`.
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  deriveDeployLive,
  loadReportDeployLive,
  type DeployDriftRunRow,
  type DeployObservationRow,
  type ReportDeployLive,
} from '../../supabase/functions/_shared/report-deploy-live.ts'

const PROJECT = '11111111-2222-4333-8444-555555555555'
const PRE = '9999999aaaaaaabbbbbbbcccccccdddddddeeeee'
const H1 = '1111111aaaaaaabbbbbbbcccccccdddddddeeeee'
const H2 = '2222222aaaaaaabbbbbbbcccccccdddddddeeeee'
const STRAY = '3333333aaaaaaabbbbbbbcccccccdddddddeeeee'
const MERGED_AT = '2026-10-02T10:00:00Z'

function run(id: string, startedAt: string, commit: string | null, completedAt: string | null = startedAt.replace(':00Z', ':05Z')): DeployDriftRunRow {
  return { id, status: 'pass', started_at: startedAt, completed_at: completedAt, commit_sha: commit }
}

/** Run before the merge on PRE, run after the merge on H1. */
const RUNS = [run('r0', '2026-10-02T03:35:00Z', PRE), run('r1', '2026-10-03T03:35:00Z', H1)]

function obs(target: string, commit: string | null, at: string, ok = true): DeployObservationRow {
  return { target_id: target, ok, observed_commit: commit, observed_at: at }
}

function mustDerive(input: Parameters<typeof deriveDeployLive>[0]): ReportDeployLive {
  const out = deriveDeployLive(input)
  if (!out) throw new Error('expected a deploy state, got null')
  return out
}

const FIXED = { project_id: PROJECT, status: 'fixed' }

describe('deriveDeployLive', () => {
  it('is live when every target runs a head read after the merge (abbreviated SHAs match)', () => {
    const out = mustDerive({
      mergedAt: MERGED_AT,
      runs: RUNS,
      observations: [obs('web', H1.slice(0, 7), '2026-10-03T03:34:00Z'), obs('api', H1, '2026-10-03T03:33:00Z')],
    })
    expect(out).toMatchObject({ state: 'live', prod_commit: H1.slice(0, 7), target_id: 'web' })
  })

  it('stays live when prod runs an older post-merge head than the newest one', () => {
    const out = mustDerive({
      mergedAt: MERGED_AT,
      runs: [...RUNS, run('r2', '2026-10-05T03:35:00Z', H2)],
      observations: [obs('web', H1, '2026-10-05T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'live', prod_commit: H1 })
  })

  it('is not_live, naming that target, when it runs the head of a run that completed before the merge', () => {
    const out = mustDerive({
      mergedAt: MERGED_AT,
      runs: RUNS,
      observations: [obs('api', H1, '2026-10-03T03:34:30Z'), obs('web', PRE, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'not_live', prod_commit: PRE, target_id: 'web' })
    expect(out.reason).toContain('web')
  })

  it('is not_live when the target was already running that commit before the merge', () => {
    const out = mustDerive({
      mergedAt: MERGED_AT,
      runs: [run('r1', '2026-10-03T03:35:00Z', H1)],
      observations: [obs('web', STRAY, '2026-10-01T03:34:00Z'), obs('web', STRAY, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'not_live', prod_commit: STRAY, target_id: 'web' })
  })

  it('a run that straddles the merge proves nothing about its head', () => {
    const out = mustDerive({
      mergedAt: MERGED_AT,
      runs: [run('straddle', '2026-10-02T09:59:00Z', STRAY, '2026-10-02T10:01:00Z'), run('r1', '2026-10-03T03:35:00Z', H1)],
      observations: [obs('web', STRAY, '2026-10-03T03:34:00Z')],
    })
    expect(out.state).toBe('unknown')
    expect(out.prod_commit).toBe(STRAY)
  })

  it('is unknown, never not_live, for a commit that is neither a post-merge head nor pre-fix', () => {
    const out = mustDerive({
      mergedAt: MERGED_AT,
      runs: [...RUNS, run('r2', '2026-10-05T03:35:00Z', H2)],
      observations: [obs('web', STRAY, '2026-10-05T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'unknown', prod_commit: STRAY, target_id: 'web' })
    expect(out.reason).toMatch(/cannot place/)
  })

  it('is unknown when no run started after the merge and nothing marks the commit pre-fix', () => {
    const out = mustDerive({ mergedAt: MERGED_AT, runs: [RUNS[0]], observations: [obs('web', STRAY, '2026-10-03T03:34:00Z')] })
    expect(out.state).toBe('unknown')
    expect(out.reason).toMatch(/not been checked since/)
  })

  it('is unknown when the newest observation predates the merge', () => {
    const out = mustDerive({ mergedAt: MERGED_AT, runs: RUNS, observations: [obs('web', PRE, '2026-10-02T03:34:00Z')] })
    expect(out.state).toBe('unknown')
    expect(out.reason).toMatch(/not been checked since/)
  })

  it('uses only the newest observation per target', () => {
    const out = mustDerive({
      mergedAt: MERGED_AT,
      runs: RUNS,
      observations: [obs('web', PRE, '2026-10-02T11:00:00Z'), obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out.state).toBe('live')
  })

  it('is unknown, not live, when one target is live and another failed its probe or sent no commit', () => {
    expect(
      mustDerive({
        mergedAt: MERGED_AT,
        runs: RUNS,
        observations: [obs('web', H1, '2026-10-03T03:34:00Z'), obs('api', PRE, '2026-10-02T00:00:00Z'), obs('api', null, '2026-10-03T03:34:00Z', false)],
      }),
    ).toMatchObject({ state: 'unknown', target_id: 'api', prod_commit: null })
    expect(
      mustDerive({
        mergedAt: MERGED_AT,
        runs: RUNS,
        observations: [obs('web', H1, '2026-10-03T03:34:00Z'), obs('api', PRE, '2026-10-02T00:00:00Z'), obs('api', null, '2026-10-03T03:34:00Z')],
      }).state,
    ).toBe('unknown')
  })

  it('never names a target already on a post-merge head as the stale prod commit', () => {
    const out = mustDerive({
      mergedAt: MERGED_AT,
      runs: RUNS,
      observations: [obs('api', H1, '2026-10-03T03:35:30Z'), obs('web', STRAY, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'unknown', target_id: 'web', prod_commit: STRAY })
  })

  it('is null (no chip) when no deploy target ever reported a commit', () => {
    expect(deriveDeployLive({ mergedAt: MERGED_AT, runs: RUNS, observations: [] })).toBeNull()
    // Store apps observed only through sdk_heartbeat carry a version, never a commit.
    expect(
      deriveDeployLive({ mergedAt: MERGED_AT, runs: RUNS, observations: [obs('ios', null, '2026-10-03T03:34:00Z'), obs('android', null, '2026-10-03T03:34:00Z')] }),
    ).toBeNull()
  })

  it('ignores version-only targets beside a target that reports commits', () => {
    const out = mustDerive({
      mergedAt: MERGED_AT,
      runs: RUNS,
      observations: [obs('ios', null, '2026-10-03T03:35:00Z'), obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'live', target_id: 'web' })
  })
})

describe('loadReportDeployLive', () => {
  function seed() {
    return makeFakeDb({
      gate_runs: [
        { id: 'r0', project_id: PROJECT, gate: 'deploy_drift', status: 'pass', started_at: '2026-10-02T03:35:00Z', completed_at: '2026-10-02T03:35:05Z', commit_sha: PRE },
        { id: 'r1', project_id: PROJECT, gate: 'deploy_drift', status: 'warn', started_at: '2026-10-03T03:35:00Z', completed_at: '2026-10-03T03:35:05Z', commit_sha: H1 },
        { id: 'r-other-gate', project_id: PROJECT, gate: 'ci_drift', status: 'warn', started_at: '2026-10-03T08:00:00Z', completed_at: null, commit_sha: STRAY },
        { id: 'r-other-project', project_id: 'another-project', gate: 'deploy_drift', status: 'pass', started_at: '2026-10-03T08:00:00Z', completed_at: '2026-10-03T08:00:05Z', commit_sha: STRAY },
      ],
      deploy_observations: [
        { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: PRE, observed_at: '2026-10-03T03:34:00Z' },
        { target_id: 'web', project_id: 'another-project', ok: true, observed_commit: H1, observed_at: '2026-10-03T05:00:00Z' },
      ],
    })
  }

  it('returns null when no fix merged', async () => {
    const out = await loadReportDeployLive(seed() as unknown as SupabaseClient, FIXED, [{ merged_at: null }, {}])
    expect(out).toBeNull()
  })

  it('returns null unless the report reads as fixed (a reopened or re-dispatched report gets no chip)', async () => {
    const db = seed()
    const merged = [{ merged_at: MERGED_AT }]
    for (const status of ['fixing', 'reopened', 'classified', 'new', 'dismissed']) {
      expect(await loadReportDeployLive(db as unknown as SupabaseClient, { project_id: PROJECT, status }, merged)).toBeNull()
    }
    for (const status of ['fixed', 'resolved', 'verified', 'completed']) {
      expect(await loadReportDeployLive(db as unknown as SupabaseClient, { project_id: PROJECT, status }, merged)).not.toBeNull()
    }
  })

  it('returns null for a project that never had a deploy target report a commit', async () => {
    const db = seed()
    db.tables.deploy_observations = db.tables.deploy_observations.filter((o) => o.project_id !== PROJECT)
    expect(await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, [{ merged_at: MERGED_AT }])).toBeNull()
  })

  it('joins the newest merge to this project\'s runs: prod on the pre-merge head is not live', async () => {
    const out = await loadReportDeployLive(seed() as unknown as SupabaseClient, FIXED, [
      { merged_at: '2026-09-30T00:00:00Z' },
      { merged_at: MERGED_AT },
    ])
    expect(out).toMatchObject({ state: 'not_live', merged_at: MERGED_AT, prod_commit: PRE, target_id: 'web' })
  })

  it('reads as live once prod runs the post-merge head', async () => {
    const db = seed()
    db.tables.deploy_observations.push({ target_id: 'web', project_id: PROJECT, ok: true, observed_commit: H1, observed_at: '2026-10-03T04:00:00Z' })
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, [{ merged_at: MERGED_AT }])
    expect(out).toMatchObject({ state: 'live', prod_commit: H1 })
  })

  it('finds a pre-merge observation of the current commit outside the newest-observation window', async () => {
    const db = seed()
    db.tables.gate_runs = db.tables.gate_runs.filter((r) => r.id !== 'r0')
    db.tables.deploy_observations = [
      { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: STRAY, observed_at: '2026-09-01T03:34:00Z' },
      // 300 newer observations of another target push the old one out of the window.
      ...Array.from({ length: 300 }, (_, i) => ({
        target_id: 'api', project_id: PROJECT, ok: true, observed_commit: H1,
        observed_at: `2026-10-03T0${4 + Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}:00Z`,
      })),
      { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: STRAY, observed_at: '2026-10-03T09:30:00Z' },
    ]
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, [{ merged_at: MERGED_AT }])
    expect(out).toMatchObject({ state: 'not_live', prod_commit: STRAY, target_id: 'web' })
  })

  it('a failed read is unknown, never live', async () => {
    const db = seed()
    const failing = {
      select: () => failing,
      eq: () => failing,
      in: () => failing,
      lt: () => failing,
      order: () => failing,
      limit: () => failing,
      then: (resolve: (v: { data: null; error: { message: string } }) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(resolve),
    }
    const broken = {
      from: (table: string) => (table === 'deploy_observations' ? failing : db.from(table)),
    }
    const out = await loadReportDeployLive(broken as unknown as SupabaseClient, FIXED, [{ merged_at: MERGED_AT }])
    expect(out).toMatchObject({ state: 'unknown', prod_commit: null })
    expect(out?.reason).toMatch(/Could not read/)
  })

  it('a failed pre-merge lookup is unknown, never live or not_live', async () => {
    const db = seed()
    let calls = 0
    const failing = {
      select: () => failing,
      eq: () => failing,
      in: () => failing,
      lt: () => failing,
      limit: () => failing,
      then: (resolve: (v: { data: null; error: { message: string } }) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'timeout' } }).then(resolve),
    }
    const broken = {
      from: (table: string) => {
        if (table !== 'deploy_observations') return db.from(table)
        calls += 1
        return calls === 1 ? db.from(table) : failing
      },
    }
    const out = await loadReportDeployLive(broken as unknown as SupabaseClient, FIXED, [{ merged_at: MERGED_AT }])
    expect(out).toMatchObject({ state: 'unknown' })
    expect(out?.reason).toMatch(/Could not read/)
  })
})

describe('loadReportDeployLive — prod lagging a newer head (review regression)', () => {
  it('stays live when prod runs a post-merge head even though a later run says prod is behind', async () => {
    // T0 merge → run on H1 (has the fix), web deployed H1 → run on H2 with an
    // open not_deployed finding because web has not caught up with H2 yet.
    const db = makeFakeDb({
      gate_runs: [
        { id: 'r1', project_id: PROJECT, gate: 'deploy_drift', status: 'pass', started_at: '2026-10-03T03:35:00Z', completed_at: '2026-10-03T03:35:05Z', commit_sha: H1 },
        { id: 'r2', project_id: PROJECT, gate: 'deploy_drift', status: 'warn', started_at: '2026-10-05T03:35:00Z', completed_at: '2026-10-05T03:35:05Z', commit_sha: H2 },
      ],
      gate_findings: [{ id: 'f1', gate_run_id: 'r2', project_id: PROJECT, rule_id: 'not_deployed', allowlisted: false }],
      deploy_observations: [
        { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: H1, observed_at: '2026-10-05T03:34:00Z' },
      ],
    })
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, [{ merged_at: MERGED_AT }])
    expect(out).toMatchObject({ state: 'live', prod_commit: H1, target_id: 'web' })
  })
})
