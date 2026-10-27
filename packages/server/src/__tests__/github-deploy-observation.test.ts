/**
 * FILE: github-deploy-observation.test.ts
 * PURPOSE: A GitHub production deployment becomes one deploy_observations
 *          row, and only a finished production one. Preview and in-progress
 *          deploys must not mark a merged fix as deployed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  observationFromGithubDeployment,
  observationsFromGithubFacts,
  recordGithubDeployObservation,
} from '../../supabase/functions/_shared/github-deploy-observation.ts'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')

describe('observationFromGithubDeployment', () => {
  const base = {
    state: 'success',
    environment: 'Production',
    sha: 'a1b2c3d4e5f6a7b8',
    ref: 'v1.2.3',
    updatedAt: '2026-10-27T01:00:00Z',
  }

  it('stores a production success at GitHub’s time, with a version tag', () => {
    expect(observationFromGithubDeployment(base)).toEqual({
      target_id: 'gh-production',
      environment: 'Production',
      observed_commit: 'a1b2c3d4e5f6a7b8',
      observed_version: 'v1.2.3',
      ok: true,
      error: null,
      source: 'github_deployment',
      observed_at: '2026-10-27T01:00:00.000Z',
    })
  })

  it('stores a failure and skips preview, staging, and an unfinished deploy', () => {
    expect(observationFromGithubDeployment({ ...base, state: 'failure' })).toMatchObject({ ok: false, error: 'GitHub deployment failure' })
    expect(observationFromGithubDeployment({ ...base, environment: 'Preview', production: false })).toBeNull()
    expect(observationFromGithubDeployment({ ...base, environment: 'staging' })).toBeNull()
    expect(observationFromGithubDeployment({ ...base, state: 'in_progress' })).toBeNull()
    expect(observationFromGithubDeployment({ ...base, sha: 'not-a-sha' })).toBeNull()
    expect(observationFromGithubDeployment({ ...base, updatedAt: null })).toBeNull()
    expect(observationFromGithubDeployment({ ...base, ref: 'main' })?.observed_version).toBeNull()
    expect(observationFromGithubDeployment({ ...base, environment: 'Preview', production: true })?.target_id).toBe('gh-preview')
  })
})

describe('observationsFromGithubFacts', () => {
  it('reads the connector fact and skips an undated one', () => {
    const rows = observationsFromGithubFacts({
      deployments: [
        { environment: 'Production', production: true, state: 'success', sha: 'a1b2c3d4e5f6a7b8', ref: 'main', updatedAt: '2026-10-27T01:00:00.000Z' },
        { environment: 'Production', production: true, state: 'success', sha: 'bbbbbbbbbbbbbbbb', updatedAt: 'not-a-time' },
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ target_id: 'gh-production', observed_commit: 'a1b2c3d4e5f6a7b8', observed_version: null, ok: true })
  })

  it('inserts once for the same GitHub timestamp', async () => {
    const db = makeFakeDb({})
    const [row] = observationsFromGithubFacts({
      deployments: [{ environment: 'Production', production: true, state: 'success', sha: 'a1b2c3d4e5f6a7b8', ref: 'v1.2.3', updatedAt: '2026-10-27T01:00:00.000Z' }],
    })
    expect(await recordGithubDeployObservation(db as never, 'p1', row!)).toBe('stored')
    expect(await recordGithubDeployObservation(db as never, 'p1', row!)).toBe('duplicate')
    expect(db.table('deploy_observations')).toHaveLength(1)
    expect(db.table('deploy_observations')[0]).toMatchObject({ project_id: 'p1', source: 'github_deployment', observed_at: '2026-10-27T01:00:00.000Z' })
  })
})

describe('wiring', () => {
  it('the daily collector stores the GitHub connector’s production deployments', () => {
    const src = readFileSync(resolve(FUNCTIONS, '_shared/recipe-phase2.ts'), 'utf8')
    expect(src).toContain('observationsFromGithubFacts(github)')
    expect(src).toContain('recordGithubDeployObservation(db, projectId, row)')
  })
})
