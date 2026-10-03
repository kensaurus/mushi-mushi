/**
 * `_shared/report-deploy-live.ts` — "Fixed — not live yet (prod is on <sha>)"
 * vs "Fixed and live" on the report detail (completeness gap #10).
 *
 * The pure `deriveDeployLive` covers every state; `loadReportDeployLive` is
 * driven against the in-memory fake db, including a failed read, which must
 * read as `unknown` and never as `live`.
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  deriveDeployLive,
  loadReportDeployLive,
  type DeployDriftRunRow,
  type DeployObservationRow,
} from '../../supabase/functions/_shared/report-deploy-live.ts'

const PROJECT = '11111111-2222-4333-8444-555555555555'
const HEAD = 'abcdef0123456789abcdef0123456789abcdef01'
const OLD = '9999999aaaaaaabbbbbbbcccccccdddddddeeeee'
const MERGED_AT = '2026-10-02T10:00:00Z'

function run(overrides: Partial<DeployDriftRunRow> = {}): DeployDriftRunRow {
  return {
    id: 'run-1',
    status: 'warn',
    started_at: '2026-10-03T03:35:00Z',
    completed_at: '2026-10-03T03:35:05Z',
    commit_sha: HEAD,
    ...overrides,
  }
}

function obs(target: string, commit: string | null, at: string, ok = true): DeployObservationRow {
  return { target_id: target, ok, observed_commit: commit, observed_at: at }
}

describe('deriveDeployLive', () => {
  it('is not_live with the stale prod commit when the run after the merge has an open not_deployed finding', () => {
    const out = deriveDeployLive({
      mergedAt: MERGED_AT,
      run: run(),
      openNotDeployed: 1,
      observations: [obs('web', OLD, '2026-10-03T03:34:00Z')],
    })
    expect(out.state).toBe('not_live')
    expect(out.prod_commit).toBe(OLD)
    expect(out.target_id).toBe('web')
    expect(out.reason).toContain('web')
  })

  it('names the behind target, not one already on head', () => {
    const out = deriveDeployLive({
      mergedAt: MERGED_AT,
      run: run(),
      openNotDeployed: 1,
      observations: [obs('api', HEAD, '2026-10-03T03:34:30Z'), obs('web', OLD, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'not_live', prod_commit: OLD, target_id: 'web' })
  })

  it('is live when every observed target runs the head the post-merge run compared against', () => {
    const out = deriveDeployLive({
      mergedAt: MERGED_AT,
      run: run({ status: 'pass' }),
      openNotDeployed: 0,
      // abbreviated SHA still matches
      observations: [obs('web', HEAD.slice(0, 7), '2026-10-03T03:34:00Z'), obs('api', HEAD, '2026-10-03T03:33:00Z')],
    })
    expect(out.state).toBe('live')
    expect(out.prod_commit).toBe(HEAD.slice(0, 7))
  })

  it('uses only the newest observation per target', () => {
    const out = deriveDeployLive({
      mergedAt: MERGED_AT,
      run: run({ status: 'pass' }),
      openNotDeployed: 0,
      observations: [obs('web', OLD, '2026-10-01T00:00:00Z'), obs('web', HEAD, '2026-10-03T03:34:00Z')],
    })
    expect(out.state).toBe('live')
  })

  it('is unknown when the latest drift run predates the merge', () => {
    const out = deriveDeployLive({
      mergedAt: MERGED_AT,
      run: run({ started_at: '2026-10-02T03:35:00Z' }),
      openNotDeployed: 1,
      observations: [obs('web', OLD, '2026-10-02T03:34:00Z')],
    })
    expect(out.state).toBe('unknown')
    expect(out.reason).toMatch(/not been checked since/)
    expect(out.prod_commit).toBe(OLD)
  })

  it('is unknown when there are no deploy checks at all', () => {
    const out = deriveDeployLive({ mergedAt: MERGED_AT, run: null, openNotDeployed: 0, observations: [] })
    expect(out).toMatchObject({ state: 'unknown', prod_commit: null })
    expect(out.reason).toMatch(/mushi\.recipe\.json/)
  })

  it('is unknown, not live, while a target is behind but inside its allowed lag', () => {
    const out = deriveDeployLive({
      mergedAt: MERGED_AT,
      run: run({ status: 'pass' }),
      openNotDeployed: 0,
      observations: [obs('web', OLD, '2026-10-03T03:34:00Z')],
    })
    expect(out).toMatchObject({ state: 'unknown', prod_commit: OLD, target_id: 'web' })
    expect(out.reason).toMatch(/catching up/)
  })

  it('is unknown when the run errored or every probe failed', () => {
    expect(
      deriveDeployLive({ mergedAt: MERGED_AT, run: run({ status: 'error' }), openNotDeployed: 0, observations: [obs('web', HEAD, '2026-10-03T03:34:00Z')] }).state,
    ).toBe('unknown')
    expect(
      deriveDeployLive({ mergedAt: MERGED_AT, run: run({ status: 'warn' }), openNotDeployed: 0, observations: [obs('web', null, '2026-10-03T03:34:00Z', false)] }).state,
    ).toBe('unknown')
  })

  it('is unknown when the run has no head commit to compare with', () => {
    const out = deriveDeployLive({
      mergedAt: MERGED_AT,
      run: run({ commit_sha: null, status: 'pass' }),
      openNotDeployed: 0,
      observations: [obs('web', HEAD, '2026-10-03T03:34:00Z')],
    })
    expect(out.state).toBe('unknown')
  })
})

describe('loadReportDeployLive', () => {
  function seed() {
    return makeFakeDb({
      gate_runs: [
        { id: 'run-old', project_id: PROJECT, gate: 'deploy_drift', status: 'pass', started_at: '2026-10-01T03:35:00Z', completed_at: '2026-10-01T03:35:05Z', commit_sha: OLD },
        { id: 'run-new', project_id: PROJECT, gate: 'deploy_drift', status: 'warn', started_at: '2026-10-03T03:35:00Z', completed_at: '2026-10-03T03:35:05Z', commit_sha: HEAD },
        { id: 'run-running', project_id: PROJECT, gate: 'deploy_drift', status: 'running', started_at: '2026-10-03T09:00:00Z', completed_at: null, commit_sha: HEAD },
        { id: 'run-other-gate', project_id: PROJECT, gate: 'ci_drift', status: 'warn', started_at: '2026-10-03T08:00:00Z', completed_at: null, commit_sha: HEAD },
      ],
      gate_findings: [
        { id: 'f1', gate_run_id: 'run-new', project_id: PROJECT, rule_id: 'not_deployed', allowlisted: false },
        { id: 'f2', gate_run_id: 'run-new', project_id: PROJECT, rule_id: 'platform_skew', allowlisted: false },
      ],
      deploy_observations: [
        { target_id: 'web', project_id: PROJECT, ok: true, observed_commit: OLD, observed_at: '2026-10-03T03:34:00Z' },
        { target_id: 'web', project_id: 'another-project', ok: true, observed_commit: HEAD, observed_at: '2026-10-03T05:00:00Z' },
      ],
    })
  }

  it('returns null when no fix merged, without reading anything', async () => {
    const db = seed()
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, PROJECT, [{ merged_at: null }, {}])
    expect(out).toBeNull()
  })

  it('joins the newest merge to the newest finished deploy_drift run and its open not_deployed finding', async () => {
    const db = seed()
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, PROJECT, [
      { merged_at: '2026-09-30T00:00:00Z' },
      { merged_at: MERGED_AT },
    ])
    expect(out).toMatchObject({ state: 'not_live', merged_at: MERGED_AT, prod_commit: OLD, target_id: 'web' })
  })

  it('reads as live once the not_deployed finding is allowlisted and prod runs head', async () => {
    const db = seed()
    db.tables.gate_findings[0].allowlisted = true
    db.tables.deploy_observations.push({ target_id: 'web', project_id: PROJECT, ok: true, observed_commit: HEAD, observed_at: '2026-10-03T04:00:00Z' })
    const out = await loadReportDeployLive(db as unknown as SupabaseClient, PROJECT, [{ merged_at: MERGED_AT }])
    expect(out?.state).toBe('live')
  })

  it('a failed read is unknown, never live', async () => {
    const db = seed()
    const failing = {
      select: () => failing,
      eq: () => failing,
      order: () => failing,
      limit: () => failing,
      then: (resolve: (v: { data: null; error: { message: string } }) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(resolve),
    }
    const broken = {
      from: (table: string) => (table === 'deploy_observations' ? failing : db.from(table)),
    }
    const out = await loadReportDeployLive(broken as unknown as SupabaseClient, PROJECT, [{ merged_at: MERGED_AT }])
    expect(out).toMatchObject({ state: 'unknown', prod_commit: null })
    expect(out?.reason).toMatch(/Could not read/)
  })
})
