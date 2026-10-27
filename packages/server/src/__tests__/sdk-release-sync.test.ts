/**
 * Mushi report 6449a621: "Check CI status" and the sdk-release-sync cron
 * swallowed a failed GitHub read as "no data", stored null check-run fields
 * and answered 200, so a 403 rate limit turned "CI failing" into "CI not
 * checked yet". A failed read now answers 502 GITHUB_UNAVAILABLE and stores
 * nothing; the cron skips the job the same way.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/sdk-release-sync.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../supabase/functions/_shared/sdk-release-sync.ts')>()
  return { ...actual, syncSdkReleaseJob: vi.fn(actual.syncSdkReleaseJob) }
})

import {
  deriveSdkReleaseUpdate,
  describeGithubReadFailure,
  syncSdkReleaseJob,
  type SdkReleaseJob,
} from '../../supabase/functions/_shared/sdk-release-sync.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const J = '2000000a-0000-4000-8000-000000000000'
const PR_URL = 'https://github.com/o/r/pull/7'

let db: FakeDb
const gh = vi.hoisted(() => ({
  pull: vi.fn(),
  checks: vi.fn(),
  deploy: vi.fn(),
  workflow: vi.fn(),
}))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  reportError: vi.fn(),
  reportMessage: vi.fn(),
  withSentry: (_name: string, handler: (req: Request) => Response | Promise<Response>) => handler,
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1')
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass, requireServiceRoleAuth: () => null }
})
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerCanAccessProject: async () => ({ allowed: true, role: 'owner' }),
}))
vi.mock('../../supabase/functions/_shared/github.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveProjectGithubToken: async () => 'gh-token',
  fetchPullRequestDetails: (...a: unknown[]) => gh.pull(...a),
  fetchLatestCheckRun: (...a: unknown[]) => gh.checks(...a),
  fetchLatestDeploymentStatusForSha: (...a: unknown[]) => gh.deploy(...a),
  fetchLatestWorkflowRunForSha: (...a: unknown[]) => gh.workflow(...a),
}))

const STORED: SdkReleaseJob = {
  id: J,
  pr_url: PR_URL,
  pr_state: 'open',
  release_status: 'blocked',
  merged_at: null,
  commit_sha: 'sha-1',
}
const STORED_ROW = {
  ...STORED,
  project_id: P,
  status: 'completed',
  check_run_status: 'completed',
  check_run_conclusion: 'failure',
  check_run_updated_at: '2026-10-26T00:00:00.000Z',
}

const openPr = { state: 'open', merged: false, headSha: 'sha-1', baseRef: 'main', mergeable: true, mergeableState: 'clean' }
const rateLimited = () => Promise.reject(new Error('check-runs fetch 403'))
const timedOut = () => Promise.reject(Object.assign(new Error('The signal has been aborted'), { name: 'TimeoutError' }))

let app: Hono
let cronApp: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: () => undefined }; serve: () => void } }).Deno = {
    env: { get: () => undefined },
    serve: () => {},
  }
  const { registerSdkUpgradeRoutes } = await import('../../supabase/functions/api/routes/sdk-upgrade.ts')
  app = new Hono()
  registerSdkUpgradeRoutes(app as never)
  ;({ app: cronApp } = await import('../../supabase/functions/sdk-release-sync/index.ts'))
})

beforeEach(() => {
  db = makeFakeDb({ sdk_upgrade_jobs: [{ ...STORED_ROW }] })
  gh.pull.mockReset().mockResolvedValue(openPr)
  gh.checks.mockReset().mockResolvedValue({ status: 'completed', conclusion: 'failure' })
  gh.deploy.mockReset().mockResolvedValue(null)
  gh.workflow.mockReset().mockResolvedValue(null)
  vi.mocked(syncSdkReleaseJob).mockClear()
})

async function sync() {
  const res = await app.request(`/v1/admin/projects/${P}/sdk-upgrade/${J}/sync`, { method: 'POST' })
  return { status: res.status, json: (await res.json()) as { ok: boolean; error?: { code: string; message: string }; data?: Record<string, unknown> } }
}

describe('POST /v1/admin/projects/:pid/sdk-upgrade/:id/sync', () => {
  it('a 403 from GitHub answers 502 GITHUB_UNAVAILABLE and keeps the stored CI fields', async () => {
    gh.checks.mockImplementation(rateLimited)
    const res = await sync()
    expect(res.status).toBe(502)
    expect(res.json.error?.code).toBe('GITHUB_UNAVAILABLE')
    expect(res.json.error?.message).toContain('HTTP 403')
    expect(db.table('sdk_upgrade_jobs')[0]).toEqual(STORED_ROW)
  })

  it('a failed PR read or a timeout also answers 502 and writes nothing', async () => {
    gh.pull.mockImplementation(() => Promise.reject(new Error('pull fetch 503')))
    expect((await sync()).status).toBe(502)
    gh.pull.mockResolvedValue(openPr)
    gh.deploy.mockImplementation(timedOut)
    const res = await sync()
    expect(res.status).toBe(502)
    expect(res.json.error?.message).toContain('timed out')
    expect(db.table('sdk_upgrade_jobs')[0]).toEqual(STORED_ROW)
  })

  it('a good read stores and returns what GitHub said', async () => {
    gh.checks.mockResolvedValue({ status: 'completed', conclusion: 'success' })
    const res = await sync()
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ releaseStatus: 'ready_to_merge', checkRunConclusion: 'success' })
    expect(db.table('sdk_upgrade_jobs')[0]).toMatchObject({
      release_status: 'ready_to_merge',
      check_run_conclusion: 'success',
    })
  })

  it('reads checks on the live head through syncSdkReleaseJob, not the stored bump', async () => {
    gh.pull.mockResolvedValue({ ...openPr, headSha: 'head-green' })
    gh.checks.mockImplementation(async (_token: string, _ref: unknown, sha: string) => ({
      status: 'completed',
      conclusion: sha === 'head-green' ? 'success' : 'failure',
    }))
    const res = await sync()
    expect(res.status).toBe(200)
    expect(syncSdkReleaseJob).toHaveBeenCalledTimes(1)
    expect(gh.checks).toHaveBeenCalledWith('gh-token', { owner: 'o', repo: 'r' }, 'head-green')
    expect(gh.checks).not.toHaveBeenCalledWith('gh-token', { owner: 'o', repo: 'r' }, 'sha-1')
    expect(db.table('sdk_upgrade_jobs')[0]).toMatchObject({
      commit_sha: 'head-green',
      check_run_conclusion: 'success',
    })
  })

  it('a failed workflow-run read (display only) does not fail the sync', async () => {
    gh.workflow.mockImplementation(() => Promise.reject(new Error('workflow runs fetch 403')))
    const res = await sync()
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ releaseStatus: 'blocked', workflowUrl: null })
  })
})

describe('syncSdkReleaseJob (shared with the sdk-release-sync cron)', () => {
  it('stores nothing when GitHub rate-limits the check-runs read', async () => {
    gh.checks.mockImplementation(rateLimited)
    const result = await syncSdkReleaseJob(db as never, 'tok', STORED)
    expect(result).toMatchObject({ ok: false, code: 'GITHUB_UNAVAILABLE' })
    expect(db.table('sdk_upgrade_jobs')[0]).toEqual(STORED_ROW)
  })

  it('reads checks for the PR head, not a stale stored sha', async () => {
    gh.pull.mockResolvedValue({ ...openPr, headSha: 'sha-2' })
    const result = await syncSdkReleaseJob(db as never, 'tok', STORED)
    expect(result.ok).toBe(true)
    expect(gh.checks).toHaveBeenCalledWith('tok', { owner: 'o', repo: 'r' }, 'sha-2')
    expect(db.table('sdk_upgrade_jobs')[0]).toMatchObject({ commit_sha: 'sha-2', release_status: 'blocked' })
  })

  it('rejects an unparseable PR url without calling GitHub', async () => {
    const result = await syncSdkReleaseJob(db as never, 'tok', { ...STORED, pr_url: 'nope' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PR_URL' })
    expect(gh.pull).not.toHaveBeenCalled()
  })

  it('an empty head falls back to the stored sha instead of skipping checks', async () => {
    gh.pull.mockResolvedValue({ ...openPr, headSha: '' })
    const result = await syncSdkReleaseJob(db as never, 'tok', STORED)
    expect(result.ok).toBe(true)
    expect(gh.checks).toHaveBeenCalledWith('tok', { owner: 'o', repo: 'r' }, 'sha-1')
  })
})

describe('POST /sdk-release-sync', () => {
  it('reads checks on the live head through syncSdkReleaseJob, not the stored bump', async () => {
    gh.pull.mockResolvedValue({ ...openPr, headSha: 'head-green' })
    gh.checks.mockImplementation(async (_token: string, _ref: unknown, sha: string) => ({
      status: 'completed',
      conclusion: sha === 'head-green' ? 'success' : 'failure',
    }))
    const res = await cronApp.request('/sdk-release-sync', { method: 'POST' })
    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean }
    expect(json.ok).toBe(true)
    expect(syncSdkReleaseJob).toHaveBeenCalledTimes(1)
    expect(gh.checks).toHaveBeenCalledWith('gh-token', { owner: 'o', repo: 'r' }, 'head-green')
    expect(gh.checks).not.toHaveBeenCalledWith('gh-token', { owner: 'o', repo: 'r' }, 'sha-1')
    expect(db.table('sdk_upgrade_jobs')[0]).toMatchObject({
      commit_sha: 'head-green',
      check_run_conclusion: 'success',
    })
  })
})

describe('deriveSdkReleaseUpdate', () => {
  const now = '2026-10-26T12:00:00.000Z'
  it('a merged PR with a successful deploy is deployed', () => {
    const out = deriveSdkReleaseUpdate(STORED, {
      pr: { ...openPr, state: 'closed', merged: true } as never,
      commitSha: 'sha-1',
      checks: { status: 'completed', conclusion: 'success' },
      deploy: { state: 'success', environment: 'prod', environmentUrl: 'https://x', updatedAt: null },
      workflow: null,
    }, now)
    expect(out.releaseStatus).toBe('deployed')
    expect(out.update).toMatchObject({ pr_state: 'merged', merged_at: now, deploy_status: 'success' })
  })

  it('no deployment yet leaves the stored deploy columns alone', () => {
    const out = deriveSdkReleaseUpdate(STORED, { pr: openPr as never, commitSha: 'sha-1', checks: null, deploy: null, workflow: null }, now)
    expect(out.update).not.toHaveProperty('deploy_status')
    expect(out.releaseStatus).toBe('pr_opened')
  })
})

describe('describeGithubReadFailure', () => {
  it('names the status or the timeout in plain words', () => {
    expect(describeGithubReadFailure(new Error('check-runs fetch 403'))).toBe("HTTP 403, likely GitHub's rate limit")
    expect(describeGithubReadFailure(new Error('pull fetch 502'))).toBe('HTTP 502')
    expect(describeGithubReadFailure(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('timed out')
    expect(describeGithubReadFailure(new TypeError('fetch failed'))).toBe('no answer')
  })
})
