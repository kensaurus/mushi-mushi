/**
 * FILE: sdk-upgrade-merge-gate.test.ts
 * PURPOSE: The SDK-upgrade merge goes through the one gated merge (ADR 0030,
 *          W1 of the final review of #534): a job whose PR is a held fix PR
 *          is refused and the job returns to "pr_opened"; an ordinary
 *          upgrade PR merges, pinned to its head.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000f-0000-4000-8000-0000000000ee'
const USER = '2000000f-0000-4000-8000-0000000000ee'
const JOB = '4000000f-0000-4000-8000-0000000000ee'
const PR = 'https://github.com/acme/app/pull/42'

const mocks = vi.hoisted(() => ({ merge: vi.fn() }))
let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'apiKey')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/sdk-upgrade-runner.ts', () => ({ runSdkUpgradeJob: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/github.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    resolveProjectGithubToken: async () => 'gh-token',
    fetchPullRequest: async () => ({ number: 42, draft: false, state: 'open', merged: false, headSha: 'head42' }),
  }
})
vi.mock('../../supabase/functions/_shared/fix-merge.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, mergeGithubPullRequest: (...a: unknown[]) => mocks.merge(...a) }
})
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, callerCanAccessProject: async () => ({ allowed: true, role: 'member' }) }
})

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerSdkUpgradeRoutes } = await import('../../supabase/functions/api/routes/sdk-upgrade.ts')
  app = new Hono()
  registerSdkUpgradeRoutes(app as never)
})

beforeEach(() => {
  mocks.merge.mockReset().mockResolvedValue({ merged: true, alreadyMerged: false, sha: 'm42' })
})

function setup(reviews: Array<Record<string, unknown>>) {
  db = makeFakeDb({
    project_repos: [{ project_id: P, repo_url: 'https://github.com/acme/app', is_primary: true }],
    sdk_upgrade_jobs: [{ id: JOB, project_id: P, pr_url: PR, pr_state: 'open', commit_sha: 'c1', release_status: 'pr_opened' }],
    fix_attempts: [],
    fix_reviews: reviews,
  })
}

const merge = async () => {
  const res = await app.request(`/v1/admin/projects/${P}/sdk-upgrade/${JOB}/merge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'squash' }),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('POST /v1/admin/projects/:pid/sdk-upgrade/:id/merge — gated', () => {
  it('refuses a PR that a review holds, and leaves the job open', async () => {
    setup([{ id: 'rev', fix_attempt_id: 'fa-x', project_id: P, repo: 'acme/app', pr_number: 42, status: 'completed', verdict: 'hold', head_sha: 'head42', reviewed_at: '2026-10-21T00:00:00Z' }])
    const res = await merge()
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('REVIEW_HOLD')
    expect(mocks.merge).not.toHaveBeenCalled()
    expect(db.tables.sdk_upgrade_jobs[0]).toMatchObject({ release_status: 'pr_opened' })
  })

  it('merges an ordinary upgrade PR as before', async () => {
    setup([])
    const res = await merge()
    expect(res.status).toBe(200)
    expect(mocks.merge).toHaveBeenCalledTimes(1)
    expect(db.tables.sdk_upgrade_jobs[0]).toMatchObject({ release_status: 'merged' })
    expect(res.json.mergedAt).toBe(db.tables.sdk_upgrade_jobs[0].merged_at)
    expect(res.json.mergedAt).toEqual(expect.any(String))
  })
})
