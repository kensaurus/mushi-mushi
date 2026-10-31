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
import { reportMessage } from '../../supabase/functions/_shared/sentry.ts'
import {
  deriveSdkReleaseUpdate,
  describeGithubReadFailure,
  syncSdkReleaseJob,
  type SdkReleaseJob,
} from '../../supabase/functions/_shared/sdk-release-sync.ts'
import { syncSdkReleaseJobRetryingPersist } from '../../supabase/functions/sdk-release-sync/persist.ts'

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
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1')
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
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
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerSdkUpgradeRoutes } = await import('../../supabase/functions/api/routes/sdk-upgrade.ts')
  app = new Hono()
  registerSdkUpgradeRoutes(app as never)
})

beforeEach(() => {
  db = makeFakeDb({ sdk_upgrade_jobs: [{ ...STORED_ROW }] })
  gh.pull.mockReset().mockResolvedValue(openPr)
  gh.checks.mockReset().mockResolvedValue({ status: 'completed', conclusion: 'failure' })
  gh.deploy.mockReset().mockResolvedValue(null)
  gh.workflow.mockReset().mockResolvedValue(null)
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

const GATEWAY_HTML =
  '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>Cloudflare Ray ID: <strong>8f21aa9c0d4e1b2a-NRT</strong></body></html>'

/**
 * The fake query builder has no way to fail an update. This stands in for
 * PostgREST: the first N updates answer with a gateway error, then the real
 * write runs. `attempts` counts update calls only.
 */
function withUpdateFailures(
  inner: FakeDb,
  failures: Array<{ message: string; status?: number; code?: string }>,
): { db: FakeDb; attempts: () => number } {
  let attempts = 0
  const queue = [...failures]
  return {
    db: {
      from(table: string) {
        const query = inner.from(table) as {
          update: (payload: Record<string, unknown>) => { eq: (key: string, value: unknown) => Promise<unknown> }
        }
        const realUpdate = query.update.bind(query)
        query.update = (payload) => {
          attempts += 1
          const fail = queue.shift()
          if (fail) {
            return {
              eq: () => Promise.resolve({
                data: null,
                error: { message: fail.message, code: fail.code ?? '' },
                ...(fail.status != null ? { status: fail.status } : {}),
              }),
            }
          }
          return realUpdate(payload)
        }
        return query
      },
    } as unknown as FakeDb,
    attempts: () => attempts,
  }
}

const noWait = async () => {}

describe('sync persist retry (Mushi report 547db71b)', () => {
  it('retries a Cloudflare 502 and then stores the CI state', async () => {
    vi.mocked(reportMessage).mockClear()
    gh.checks.mockResolvedValue({ status: 'completed', conclusion: 'success' })
    const inner = db
    const gateway = withUpdateFailures(inner, [{ message: '502 Bad Gateway' }])
    const result = await syncSdkReleaseJobRetryingPersist(gateway.db as never, 'tok', STORED, { sleep: noWait })
    expect(result.ok).toBe(true)
    expect(gateway.attempts()).toBe(2)
    // A 502 on the write must not read GitHub again.
    expect(gh.pull).toHaveBeenCalledTimes(1)
    expect(gh.checks).toHaveBeenCalledTimes(1)
    expect(gh.deploy).toHaveBeenCalledTimes(1)
    expect(inner.table('sdk_upgrade_jobs')[0]).toMatchObject({ release_status: 'ready_to_merge' })
    expect(reportMessage).not.toHaveBeenCalled()
  })

  it('gives up after three gateway 502s, keeps the row, and logs the cf-ray without the HTML page', async () => {
    vi.mocked(reportMessage).mockClear()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const inner = db
    const gateway = withUpdateFailures(inner, Array.from({ length: 5 }, () => ({ status: 502, message: GATEWAY_HTML })))
    const result = await syncSdkReleaseJobRetryingPersist(gateway.db as never, 'tok', STORED, { sleep: noWait })
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n')
    warn.mockRestore()
    expect(result).toMatchObject({ ok: false, code: 'SYNC_PERSIST_FAILED' })
    expect(result.ok ? '' : result.message).toBe('Could not save the CI status (HTTP 502). Retry in a moment.')
    expect(result.ok ? '' : result.message).not.toContain('<')
    expect(logged).toContain('8f21aa9c0d4e1b2a-NRT')
    expect(logged).toContain('502 Bad Gateway')
    expect(logged).not.toContain('<!DOCTYPE')
    expect(gateway.attempts()).toBe(3)
    expect(gh.pull).toHaveBeenCalledTimes(1)
    expect(gh.checks).toHaveBeenCalledTimes(1)
    expect(gh.deploy).toHaveBeenCalledTimes(1)
    expect(inner.table('sdk_upgrade_jobs')[0]).toEqual(STORED_ROW)
    // Every attempt failed: an error, so Sentry still hears about the outage.
    const reported = JSON.stringify(vi.mocked(reportMessage).mock.calls)
    expect(reported).toContain('failed to persist sync')
    expect(reported).toContain('8f21aa9c0d4e1b2a-NRT')
    expect(reported).not.toContain('<!DOCTYPE')
  })

  it('retries when the update throws a gateway page', async () => {
    vi.mocked(reportMessage).mockClear()
    gh.checks.mockResolvedValue({ status: 'completed', conclusion: 'success' })
    const inner = db
    let calls = 0
    const flaky = {
      from(table: string) {
        const query = inner.from(table) as {
          update: (payload: Record<string, unknown>) => { eq: (key: string, value: unknown) => Promise<unknown> }
        }
        const realUpdate = query.update.bind(query)
        query.update = (payload) => {
          calls += 1
          if (calls === 1) return { eq: () => Promise.reject(new Error(GATEWAY_HTML)) }
          return realUpdate(payload)
        }
        return query
      },
    }
    const result = await syncSdkReleaseJobRetryingPersist(flaky as never, 'tok', STORED, { sleep: noWait })
    expect(result.ok).toBe(true)
    expect(calls).toBe(2)
    expect(gh.pull).toHaveBeenCalledTimes(1)
    expect(gh.checks).toHaveBeenCalledTimes(1)
    expect(gh.deploy).toHaveBeenCalledTimes(1)
    expect(inner.table('sdk_upgrade_jobs')[0]).toMatchObject({ release_status: 'ready_to_merge' })
    expect(reportMessage).not.toHaveBeenCalled()
  })

  it('a thrown fetch failure or timeout from GitHub is not a persist failure and is not retried', async () => {
    const inner = db
    const gateway = withUpdateFailures(inner, [])
    gh.checks.mockImplementation(() => Promise.reject(new TypeError('fetch failed')))
    const fetched = await syncSdkReleaseJobRetryingPersist(gateway.db as never, 'tok', STORED, { sleep: noWait })
    expect(fetched).toMatchObject({ ok: false, code: 'GITHUB_UNAVAILABLE' })
    expect(gh.checks).toHaveBeenCalledTimes(1)
    expect(gateway.attempts()).toBe(0)
    expect(inner.table('sdk_upgrade_jobs')[0]).toEqual(STORED_ROW)

    gh.checks.mockImplementation(timedOut)
    const timed = await syncSdkReleaseJobRetryingPersist(gateway.db as never, 'tok', STORED, { sleep: noWait })
    expect(timed).toMatchObject({ ok: false, code: 'GITHUB_UNAVAILABLE' })
    expect(timed.ok ? '' : timed.message).toContain('timed out')
    expect(gh.checks).toHaveBeenCalledTimes(2)
    expect(gateway.attempts()).toBe(0)
  })

  it('a thrown fetch failed from the update is retried without reading GitHub again', async () => {
    vi.mocked(reportMessage).mockClear()
    gh.checks.mockResolvedValue({ status: 'completed', conclusion: 'success' })
    const inner = db
    let calls = 0
    const flaky = {
      from(table: string) {
        const query = inner.from(table) as {
          update: (payload: Record<string, unknown>) => { eq: (key: string, value: unknown) => Promise<unknown> }
        }
        const realUpdate = query.update.bind(query)
        query.update = (payload) => {
          calls += 1
          if (calls === 1) return { eq: () => Promise.reject(new TypeError('fetch failed')) }
          return realUpdate(payload)
        }
        return query
      },
    }
    const result = await syncSdkReleaseJobRetryingPersist(flaky as never, 'tok', STORED, { sleep: noWait })
    expect(result.ok).toBe(true)
    expect(calls).toBe(2)
    expect(gh.pull).toHaveBeenCalledTimes(1)
    expect(gh.checks).toHaveBeenCalledTimes(1)
    expect(gh.deploy).toHaveBeenCalledTimes(1)
    expect(reportMessage).not.toHaveBeenCalled()
  })

  it('does not retry a database error that is not a gateway blip', async () => {
    vi.mocked(reportMessage).mockClear()
    const inner = db
    const gateway = withUpdateFailures(inner, [
      { status: 409, message: 'duplicate key value violates unique constraint' },
    ])
    const result = await syncSdkReleaseJobRetryingPersist(gateway.db as never, 'tok', STORED, { sleep: noWait })
    expect(result).toMatchObject({ ok: false, code: 'SYNC_PERSIST_FAILED' })
    expect(gateway.attempts()).toBe(1)
    expect(inner.table('sdk_upgrade_jobs')[0]).toEqual(STORED_ROW)
    expect(reportMessage).toHaveBeenCalled()
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
