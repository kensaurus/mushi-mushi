/**
 * `_shared/report-deploy-live.ts` — "Fixed — not live yet (prod is on <sha>)"
 * vs "Fixed and live" on the report detail (completeness gap #10).
 *
 * Each target's own commit is placed before or after the merge: a post-merge
 * deploy_drift head means live, a commit from a run that completed before
 * the merge (or one a target ran before the merge) means not live, anything
 * else is unknown. Only production targets declared in the current recipe
 * manifest count, and the heads only speak for a fix merged into the repo
 * they were read from. A failed read is `unknown`, never `live`.
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  declaredProductionTargets,
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
const FRONT = 'acme/sbc-front'
const BACK = 'acme/sbc-be'
const FRONT_PR = 'https://github.com/acme/sbc-front/pull/12'
const BACK_PR = 'https://github.com/acme/sbc-be/pull/7'

function run(
  id: string,
  startedAt: string,
  commit: string | null,
  completedAt: string | null = startedAt.replace(':00Z', ':05Z'),
  headRepo: string | null = null,
): DeployDriftRunRow {
  return { id, status: 'pass', started_at: startedAt, completed_at: completedAt, commit_sha: commit, head_repo: headRepo }
}

/** Run before the merge on PRE, run after the merge on H1. */
const RUNS = [run('r0', '2026-10-02T03:35:00Z', PRE), run('r1', '2026-10-03T03:35:00Z', H1)]

function obs(target: string, commit: string | null, at: string, ok = true): DeployObservationRow {
  return { target_id: target, ok, observed_commit: commit, observed_at: at }
}

/** A fix merged into the watched repo, every test target declared. */
const BASE = {
  mergedAt: MERGED_AT,
  fixRepos: [FRONT] as Array<string | null>,
  watchedRepo: FRONT as string | null,
  declaredTargets: new Set(['web', 'api', 'ios', 'android']) as ReadonlySet<string>,
}

type DeriveInput = Parameters<typeof deriveDeployLive>[0]

function derive(input: Partial<DeriveInput> & Pick<DeriveInput, 'runs' | 'observations'>): ReportDeployLive | null {
  return deriveDeployLive({ ...BASE, ...input })
}

function mustDerive(input: Partial<DeriveInput> & Pick<DeriveInput, 'runs' | 'observations'>): ReportDeployLive {
  const out = derive(input)
  if (!out) throw new Error('expected a deploy state, got null')
  return out
}

const FIXED = { project_id: PROJECT, status: 'fixed' }

describe('deriveDeployLive', () => {
  it('is live when every target runs a head read after the merge (abbreviated SHAs match)', () => {
    const out = mustDerive({
      runs: RUNS,
      observations: [obs('web', H1.slice(0, 7), '2026-10-03T03:34:00Z'), obs('api', H1, '2026-10-03T03:33:00Z')],
    })
    expect(out).toMatchObject({ state: 'live', prod_commit: H1.slice(0, 7), target_id: 'web' })
  })

  it('stays live when prod runs an older post-merge head than the newest one', () => {
    const out = mustDerive({
      runs: [...RUNS, run('r2', '2026-10-05T03:35:00Z', H2)],
      observations: [obs('web', H1, '2026-10-05T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'live', prod_commit: H1 })
  })

  it('is not_live, naming that target, when it runs the head of a run that completed before the merge', () => {
    const out = mustDerive({
      runs: RUNS,
      observations: [obs('api', H1, '2026-10-03T03:34:30Z'), obs('web', PRE, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'not_live', prod_commit: PRE, target_id: 'web' })
    expect(out.reason).toContain('web')
  })

  it('is not_live when the target was already running that commit before the merge', () => {
    const out = mustDerive({
      runs: [run('r1', '2026-10-03T03:35:00Z', H1)],
      observations: [obs('web', STRAY, '2026-10-01T03:34:00Z'), obs('web', STRAY, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'not_live', prod_commit: STRAY, target_id: 'web' })
  })

  it('a run that straddles the merge proves nothing about its head', () => {
    const out = mustDerive({
      runs: [run('straddle', '2026-10-02T09:59:00Z', STRAY, '2026-10-02T10:01:00Z'), run('r1', '2026-10-03T03:35:00Z', H1)],
      observations: [obs('web', STRAY, '2026-10-03T03:34:00Z')],
    })
    expect(out.state).toBe('unknown')
    expect(out.prod_commit).toBe(STRAY)
  })

  it('is unknown, never not_live, for a commit that is neither a post-merge head nor pre-fix', () => {
    const out = mustDerive({
      runs: [...RUNS, run('r2', '2026-10-05T03:35:00Z', H2)],
      observations: [obs('web', STRAY, '2026-10-05T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'unknown', prod_commit: STRAY, target_id: 'web' })
    expect(out.reason).toMatch(/cannot place/)
  })

  it('is unknown when no run started after the merge and nothing marks the commit pre-fix', () => {
    const out = mustDerive({ runs: [RUNS[0]], observations: [obs('web', STRAY, '2026-10-03T03:34:00Z')] })
    expect(out.state).toBe('unknown')
    expect(out.reason).toMatch(/not been checked since/)
  })

  it('is unknown when the newest observation predates the merge', () => {
    const out = mustDerive({ runs: RUNS, observations: [obs('web', PRE, '2026-10-02T03:34:00Z')] })
    expect(out.state).toBe('unknown')
    expect(out.reason).toMatch(/not been checked since/)
  })

  it('uses only the newest observation per target', () => {
    const out = mustDerive({
      runs: RUNS,
      observations: [obs('web', PRE, '2026-10-02T11:00:00Z'), obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out.state).toBe('live')
  })

  it('is unknown, not live, when one target is live and another failed its probe or sent no commit', () => {
    expect(
      mustDerive({
        runs: RUNS,
        observations: [obs('web', H1, '2026-10-03T03:34:00Z'), obs('api', PRE, '2026-10-02T00:00:00Z'), obs('api', null, '2026-10-03T03:34:00Z', false)],
      }),
    ).toMatchObject({ state: 'unknown', target_id: 'api', prod_commit: null })
    expect(
      mustDerive({
        runs: RUNS,
        observations: [obs('web', H1, '2026-10-03T03:34:00Z'), obs('api', PRE, '2026-10-02T00:00:00Z'), obs('api', null, '2026-10-03T03:34:00Z')],
      }).state,
    ).toBe('unknown')
  })

  it('never names a target already on a post-merge head as the stale prod commit', () => {
    const out = mustDerive({
      runs: RUNS,
      observations: [obs('api', H1, '2026-10-03T03:35:30Z'), obs('web', STRAY, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'unknown', target_id: 'web', prod_commit: STRAY })
  })

  it('is null (no chip) when no deploy target ever reported a commit', () => {
    expect(derive({ runs: RUNS, observations: [] })).toBeNull()
    // Store apps observed only through sdk_heartbeat carry a version, never a commit.
    expect(
      derive({ runs: RUNS, observations: [obs('ios', null, '2026-10-03T03:34:00Z'), obs('android', null, '2026-10-03T03:34:00Z')] }),
    ).toBeNull()
  })

  it('ignores version-only targets beside a target that reports commits', () => {
    const out = mustDerive({
      runs: RUNS,
      observations: [obs('ios', null, '2026-10-03T03:35:00Z'), obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'live', target_id: 'web' })
  })
})

describe('deriveDeployLive — the head did not move across the merge (review regression)', () => {
  it('is unknown, not live, when a pre-merge run and a post-merge run read the same head', () => {
    const out = mustDerive({
      runs: [run('r0', '2026-10-02T03:35:00Z', H1), run('r1', '2026-10-03T03:35:00Z', H1)],
      observations: [obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'unknown', target_id: 'web', prod_commit: H1 })
    expect(out.reason).toMatch(/both before and after/)
  })

  it('is unknown, not live, when the target already ran the post-merge head before the merge', () => {
    const out = mustDerive({
      runs: [run('r1', '2026-10-03T03:35:00Z', H1)],
      observations: [obs('web', H1, '2026-10-01T03:34:00Z'), obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'unknown', target_id: 'web', prod_commit: H1 })
  })
})

describe('deriveDeployLive — the fix merged into another repo (review regression)', () => {
  const live = { runs: RUNS, observations: [obs('web', H1, '2026-10-03T03:34:00Z')] }

  it('is unknown, never live, when the only merged attempt is in a sibling repo', () => {
    const out = mustDerive({ ...live, fixRepos: [BACK] })
    expect(out).toMatchObject({ state: 'unknown', prod_commit: null, target_id: null })
    expect(out.reason).toContain(BACK)
    expect(out.reason).toContain(FRONT)
  })

  it('is unknown when a sibling-repo attempt merged after the watched-repo one', () => {
    expect(mustDerive({ ...live, fixRepos: [FRONT, BACK] }).state).toBe('unknown')
  })

  it('is unknown when a sibling-repo attempt merged before the watched-repo one', () => {
    expect(mustDerive({ ...live, fixRepos: [BACK, FRONT] }).state).toBe('unknown')
  })

  it('is not not_live either: a pre-fix commit of the watched repo says nothing about the sibling repo', () => {
    const out = mustDerive({ runs: RUNS, observations: [obs('web', PRE, '2026-10-03T03:34:00Z')], fixRepos: [BACK] })
    expect(out.state).toBe('unknown')
  })

  it('is unknown when a merged attempt has no readable PR URL, or no primary repo is connected', () => {
    expect(mustDerive({ ...live, fixRepos: [FRONT, null] }).reason).toMatch(/cannot tell which repo/)
    expect(mustDerive({ ...live, fixRepos: [] }).state).toBe('unknown')
    expect(mustDerive({ ...live, watchedRepo: null }).reason).toMatch(/No primary GitHub repo/)
  })

  it('compares repos case-insensitively', () => {
    expect(mustDerive({ ...live, fixRepos: ['ACME/SBC-Front'], watchedRepo: FRONT }).state).toBe('live')
  })

  it('keeps the no-chip rule ahead of the repo check', () => {
    expect(derive({ runs: RUNS, observations: [obs('ios', null, '2026-10-03T03:34:00Z')], fixRepos: [BACK] })).toBeNull()
  })

  it('ignores a run whose head was read from a different repo', () => {
    const out = mustDerive({
      runs: [RUNS[0], run('r1', '2026-10-03T03:35:00Z', H1, undefined, BACK)],
      observations: [obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out.state).toBe('unknown')
    expect(
      mustDerive({
        runs: [RUNS[0], run('r1', '2026-10-03T03:35:00Z', H1, undefined, FRONT)],
        observations: [obs('web', H1, '2026-10-03T03:34:00Z')],
      }).state,
    ).toBe('live')
  })
})

describe('deriveDeployLive — only declared production targets count (review regression)', () => {
  it('a removed target whose last check predates the merge does not turn live into unknown', () => {
    const out = mustDerive({
      declaredTargets: new Set(['web']),
      runs: RUNS,
      observations: [obs('old-web', PRE, '2026-09-20T03:34:00Z'), obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'live', target_id: 'web' })
  })

  it('an ad-hoc webhook target lagging on a pre-fix commit is not reported as prod', () => {
    const out = mustDerive({
      declaredTargets: new Set(['web']),
      runs: RUNS,
      observations: [obs('webhook-preview', PRE, '2026-10-03T05:00:00Z'), obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'live', target_id: 'web' })
  })

  it('a pre-merge observation of an undeclared target is not pre-fix evidence for a declared one', () => {
    const out = mustDerive({
      declaredTargets: new Set(['web']),
      runs: RUNS,
      observations: [obs('other-app', H1, '2026-10-01T03:34:00Z'), obs('web', H1, '2026-10-03T03:34:00Z')],
    })
    expect(out.state).toBe('live')
  })

  it('is null when only undeclared targets ever reported a commit', () => {
    expect(derive({ declaredTargets: new Set(['web']), runs: RUNS, observations: [obs('old-web', H1, '2026-10-03T03:34:00Z')] })).toBeNull()
  })
})

describe('declaredProductionTargets', () => {
  it('keeps targets with no environment or a production one, drops staging and malformed rows', () => {
    const ids = declaredProductionTargets({
      deploy: {
        targets: [
          { id: 'web-prod', environment: 'production' },
          { id: 'api', environment: 'Prod' },
          { id: 'web' },
          { id: 'web-staging', environment: 'staging' },
          { id: 'preview', environment: 'preview' },
          { environment: 'production' },
          { id: '  ' },
          null,
        ],
      },
    })
    expect([...ids].sort()).toEqual(['api', 'web', 'web-prod'])
  })

  it('is empty without a manifest or deploy targets', () => {
    expect(declaredProductionTargets(null).size).toBe(0)
    expect(declaredProductionTargets({ deploy: {} }).size).toBe(0)
    expect(declaredProductionTargets({ deploy: { targets: 'web' } }).size).toBe(0)
  })
})

const MANIFEST = { deploy: { targets: [{ id: 'web', environment: 'production', probe: { type: 'version_json', url: 'https://x/version.json' } }] } }

function seed() {
  return makeFakeDb({
    app_recipe_snapshots: [
      { id: 's1', project_id: PROJECT, is_current: true, manifest: MANIFEST },
      { id: 's0', project_id: PROJECT, is_current: false, manifest: { deploy: { targets: [{ id: 'old-web' }] } } },
    ],
    project_repos: [
      { id: 'repo-front', project_id: PROJECT, is_primary: true, repo_url: 'https://github.com/acme/sbc-front' },
      { id: 'repo-back', project_id: PROJECT, is_primary: false, repo_url: 'https://github.com/acme/sbc-be' },
    ],
    gate_runs: [
      { id: 'r0', project_id: PROJECT, gate: 'deploy_drift', status: 'pass', started_at: '2026-10-02T03:35:00Z', completed_at: '2026-10-02T03:35:05Z', commit_sha: PRE, summary: { head_repo: FRONT } },
      { id: 'r1', project_id: PROJECT, gate: 'deploy_drift', status: 'warn', started_at: '2026-10-03T03:35:00Z', completed_at: '2026-10-03T03:35:05Z', commit_sha: H1, summary: { head_repo: 'Acme/SBC-Front' } },
      { id: 'r-other-gate', project_id: PROJECT, gate: 'ci_drift', status: 'warn', started_at: '2026-10-03T08:00:00Z', completed_at: null, commit_sha: STRAY, summary: null },
      { id: 'r-other-project', project_id: 'another-project', gate: 'deploy_drift', status: 'pass', started_at: '2026-10-03T08:00:00Z', completed_at: '2026-10-03T08:00:05Z', commit_sha: STRAY, summary: null },
    ],
    deploy_observations: [
      { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: PRE, observed_at: '2026-10-03T03:34:00Z' },
      { target_id: 'web', project_id: 'another-project', ok: true, observed_commit: H1, observed_at: '2026-10-03T05:00:00Z' },
    ],
  })
}

const FRONT_MERGE = [{ merged_at: MERGED_AT, pr_url: FRONT_PR }]

describe('loadReportDeployLive', () => {
  it('returns null when no fix merged', async () => {
    const out = await loadReportDeployLive(seed() as unknown as SupabaseClient, FIXED, [{ merged_at: null, pr_url: FRONT_PR }, {}])
    expect(out).toBeNull()
  })

  it('returns null unless the report reads as fixed (a reopened or re-dispatched report gets no chip)', async () => {
    const db = seed()
    for (const status of ['fixing', 'reopened', 'classified', 'new', 'dismissed']) {
      expect(await loadReportDeployLive(db as unknown as SupabaseClient, { project_id: PROJECT, status }, FRONT_MERGE)).toBeNull()
    }
    for (const status of ['fixed', 'resolved', 'verified', 'completed']) {
      expect(await loadReportDeployLive(db as unknown as SupabaseClient, { project_id: PROJECT, status }, FRONT_MERGE)).not.toBeNull()
    }
  })

  it('returns null for a project that never had a deploy target report a commit', async () => {
    const db = seed()
    db.tables.deploy_observations = db.tables.deploy_observations.filter((o) => o.project_id !== PROJECT)
    expect(await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, FRONT_MERGE)).toBeNull()
  })

  it('returns null when the project has no current recipe manifest or it declares no production target', async () => {
    const db = seed()
    db.tables.app_recipe_snapshots = db.tables.app_recipe_snapshots.filter((s) => s.is_current !== true)
    expect(await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, FRONT_MERGE)).toBeNull()
    db.tables.app_recipe_snapshots.push({ id: 's2', project_id: PROJECT, is_current: true, manifest: { deploy: { targets: [{ id: 'web', environment: 'staging' }] } } })
    expect(await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, FRONT_MERGE)).toBeNull()
  })

  it('joins the newest merge to this project\'s runs: prod on the pre-merge head is not live', async () => {
    const out = await loadReportDeployLive(seed() as unknown as SupabaseClient, FIXED, [
      { merged_at: '2026-09-30T00:00:00Z', pr_url: 'https://github.com/acme/sbc-front/pull/11' },
      ...FRONT_MERGE,
    ])
    expect(out).toMatchObject({ state: 'not_live', merged_at: MERGED_AT, prod_commit: PRE, target_id: 'web' })
  })

  it('reads as live once prod runs the post-merge head', async () => {
    const db = seed()
    db.tables.deploy_observations.push({ target_id: 'web', project_id: PROJECT, ok: true, observed_commit: H1, observed_at: '2026-10-03T04:00:00Z' })
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, FRONT_MERGE)
    expect(out).toMatchObject({ state: 'live', prod_commit: H1 })
  })

  it('is unknown, never live, for a fix that merged into a sibling repo (cross-repo attempt on the same report)', async () => {
    const db = seed()
    db.tables.deploy_observations.push({ target_id: 'web', project_id: PROJECT, ok: true, observed_commit: H1, observed_at: '2026-10-03T04:00:00Z' })
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, [
      { merged_at: '2026-10-02T09:00:00Z', pr_url: FRONT_PR },
      { merged_at: MERGED_AT, pr_url: BACK_PR },
    ])
    expect(out).toMatchObject({ state: 'unknown', merged_at: MERGED_AT })
    expect(out?.reason).toContain(BACK)
  })

  it('does not count a run whose recorded head repo is not the primary repo', async () => {
    const db = seed()
    const r1 = db.tables.gate_runs.find((r) => r.id === 'r1')
    if (!r1) throw new Error('seed lost r1')
    r1.summary = { head_repo: BACK }
    db.tables.deploy_observations.push({ target_id: 'web', project_id: PROJECT, ok: true, observed_commit: H1, observed_at: '2026-10-03T04:00:00Z' })
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, FRONT_MERGE)
    expect(out?.state).toBe('unknown')
  })

  it('ignores an undeclared target, even a lagging one with only pre-merge checks', async () => {
    const db = seed()
    db.tables.deploy_observations.push(
      { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: H1, observed_at: '2026-10-03T04:00:00Z' },
      { target_id: 'old-web', project_id: PROJECT, ok: true, observed_commit: PRE, observed_at: '2026-09-15T03:34:00Z' },
      { target_id: 'adhoc-webhook', project_id: PROJECT, ok: true, observed_commit: PRE, observed_at: '2026-10-03T06:00:00Z' },
    )
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, FRONT_MERGE)
    expect(out).toMatchObject({ state: 'live', target_id: 'web', prod_commit: H1 })
  })

  it('finds a pre-merge observation of the current commit outside the newest-observation window', async () => {
    const db = seed()
    db.tables.gate_runs = db.tables.gate_runs.filter((r) => r.id !== 'r0')
    db.tables.app_recipe_snapshots[0].manifest = { deploy: { targets: [{ id: 'web' }, { id: 'api' }] } }
    db.tables.deploy_observations = [
      { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: STRAY, observed_at: '2026-09-01T03:34:00Z' },
      // 300 newer observations of another target push the old one out of the window.
      ...Array.from({ length: 300 }, (_, i) => ({
        target_id: 'api', project_id: PROJECT, ok: true, observed_commit: H1,
        observed_at: `2026-10-03T0${4 + Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}:00Z`,
      })),
      { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: STRAY, observed_at: '2026-10-03T09:30:00Z' },
    ]
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, FRONT_MERGE)
    expect(out).toMatchObject({ state: 'not_live', prod_commit: STRAY, target_id: 'web' })
  })

  function failingQuery(message: string) {
    const failing = {
      select: () => failing,
      eq: () => failing,
      in: () => failing,
      lt: () => failing,
      order: () => failing,
      limit: () => failing,
      maybeSingle: () => failing,
      then: (resolve: (v: { data: null; error: { message: string } }) => unknown) =>
        Promise.resolve({ data: null, error: { message } }).then(resolve),
    }
    return failing
  }

  for (const table of ['deploy_observations', 'gate_runs', 'app_recipe_snapshots', 'project_repos']) {
    it(`a failed ${table} read is unknown, never live`, async () => {
      const db = seed()
      db.tables.deploy_observations.push({ target_id: 'web', project_id: PROJECT, ok: true, observed_commit: H1, observed_at: '2026-10-03T04:00:00Z' })
      const broken = { from: (t: string) => (t === table ? failingQuery('permission denied') : db.from(t)) }
      const out = await loadReportDeployLive(broken as unknown as SupabaseClient, FIXED, FRONT_MERGE)
      expect(out).toMatchObject({ state: 'unknown', prod_commit: null })
      expect(out?.reason).toMatch(/Could not read/)
    })
  }

  it('a failed pre-merge lookup is unknown, never live or not_live', async () => {
    const db = seed()
    let calls = 0
    const broken = {
      from: (table: string) => {
        if (table !== 'deploy_observations') return db.from(table)
        calls += 1
        return calls === 1 ? db.from(table) : failingQuery('timeout')
      },
    }
    const out = await loadReportDeployLive(broken as unknown as SupabaseClient, FIXED, FRONT_MERGE)
    expect(out).toMatchObject({ state: 'unknown' })
    expect(out?.reason).toMatch(/Could not read/)
  })
})

describe('loadReportDeployLive — prod lagging a newer head (review regression)', () => {
  it('stays live when prod runs a post-merge head even though a later run says prod is behind', async () => {
    // T0 merge → run on H1 (has the fix), web deployed H1 → run on H2 with an
    // open not_deployed finding because web has not caught up with H2 yet.
    const db = makeFakeDb({
      app_recipe_snapshots: [{ id: 's1', project_id: PROJECT, is_current: true, manifest: MANIFEST }],
      project_repos: [{ id: 'repo-front', project_id: PROJECT, is_primary: true, repo_url: 'https://github.com/acme/sbc-front.git' }],
      gate_runs: [
        { id: 'r1', project_id: PROJECT, gate: 'deploy_drift', status: 'pass', started_at: '2026-10-03T03:35:00Z', completed_at: '2026-10-03T03:35:05Z', commit_sha: H1, summary: null },
        { id: 'r2', project_id: PROJECT, gate: 'deploy_drift', status: 'warn', started_at: '2026-10-05T03:35:00Z', completed_at: '2026-10-05T03:35:05Z', commit_sha: H2, summary: null },
      ],
      gate_findings: [{ id: 'f1', gate_run_id: 'r2', project_id: PROJECT, rule_id: 'not_deployed', allowlisted: false }],
      deploy_observations: [
        { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: H1, observed_at: '2026-10-05T03:34:00Z' },
      ],
    })
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, FIXED, FRONT_MERGE)
    expect(out).toMatchObject({ state: 'live', prod_commit: H1, target_id: 'web' })
  })
})
