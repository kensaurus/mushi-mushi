/**
 * FILE: sdk-upgrade-lockfile-helper.test.ts
 * PURPOSE: ADR 0019 — SDK upgrade PRs get their lockfile from a host workflow.
 *
 * - runner: helper workflow present → one bump commit pushed, job parked in
 *   awaiting_lockfile, no PR; absent → PR opened at once, body links the docs.
 * - sdk-release-sync sweep: a lockfile commit after the bump → PR opened and
 *   the job completed / pr_opened; 30 minutes without one → PR opened with
 *   the "lockfile not refreshed" note; unreachable GitHub past the wait → failed.
 * - migration: the status CHECK keeps every earlier value and adds the new one.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeDb, findQueries, type FakeQuery } from './__stubs__/fake-query-recorder.ts'

const OWNER = 'acme'
const REPO = 'app'
const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const JOB = 'job-1'

const state = vi.hoisted(() => ({
  db: null as unknown,
  helperPresent: false,
  // GET responses keyed by URL substring, first match wins.
  ghRoutes: [] as Array<[string, unknown]>,
}))

const gh = vi.hoisted(() => ({
  createPrFromFiles: vi.fn(async (opts: { branch: string }) => ({
    url: 'https://github.com/acme/app/pull/7',
    number: 7,
    branch: opts.branch,
    commitSha: 'bump-sha-direct',
  })),
  createBranchWithSingleCommit: vi.fn(async () => 'bump-sha'),
  resolveBaseBranch: vi.fn(async () => ({ branch: 'main', sha: 'base-sha' })),
  openPullRequestForBranch: vi.fn(async () => ({ url: 'https://github.com/acme/app/pull/9', number: 9 })),
  findOpenPrByHeadPrefix: vi.fn(async () => null),
  commitFilesToBranch: vi.fn(async () => 'refresh-sha'),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  resolveProjectGithubToken: async () => 'ghs_token',
  parseGithubRepoUrl: (url: string | null) => (url ? { owner: OWNER, repo: REPO } : null),
}))
vi.mock('../../supabase/functions/_shared/sdk-observation.ts', () => ({
  upsertProjectSdkObservationAsync: () => undefined,
}))
vi.mock('../../supabase/functions/_shared/sdk-upgrade-plan.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../supabase/functions/_shared/sdk-upgrade-plan.ts')>()),
  fetchAllLatestVersions: async () => ({ '@mushi-mushi/web': '1.31.0' }),
}))
vi.mock('../../supabase/functions/_shared/github-pr.ts', () => ({
  ...gh,
  ghFetchOptional: async (url: string) => {
    if (url.includes('/contents/.github/workflows/mushi-sdk-lockfile.yml')) {
      return state.helperPresent ? { type: 'file', path: '.github/workflows/mushi-sdk-lockfile.yml' } : null
    }
    for (const [needle, body] of state.ghRoutes) if (url.includes(needle)) return body
    return null
  },
}))

import { runSdkUpgradeJob } from '../../supabase/functions/_shared/sdk-upgrade-runner.ts'
import { LOCKFILE_WAIT_MS, syncAwaitingLockfileJobs } from '../../supabase/functions/_shared/sdk-upgrade-lockfile.ts'
import { LOCKFILE_HELPER_DOCS_URL } from '../../supabase/functions/_shared/sdk-upgrade-pr.ts'

const PKG = { name: 'host', dependencies: { '@mushi-mushi/web': '^1.29.0' } }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

function runnerRoutes(): Array<[string, unknown]> {
  return [
    [`/repos/${OWNER}/${REPO}/git/trees/`, { tree: [{ path: 'package.json', type: 'blob' }] }],
    [`/repos/${OWNER}/${REPO}/contents/package.json?ref=main`, { content: b64(JSON.stringify(PKG)) }],
    [`/repos/${OWNER}/${REPO}/contents/`, null],
    [`/repos/${OWNER}/${REPO}`, { default_branch: 'main' }],
  ]
}

function runnerDb() {
  return createFakeDb((q: FakeQuery) => {
    if (q.table === 'sdk_upgrade_jobs' && q.op === 'select') {
      return { data: { id: JOB, project_id: PROJECT, status: 'queued', started_at: null } }
    }
    if (q.table === 'sdk_upgrade_jobs' && q.op === 'update') return { data: [{ id: JOB }] }
    if (q.table === 'project_settings') return { data: { github_repo_url: `https://github.com/${OWNER}/${REPO}` } }
    return { data: null }
  })
}

const lastUpdate = (queries: FakeQuery[]) =>
  findQueries(queries, 'sdk_upgrade_jobs', 'update').at(-1)?.payload as Record<string, unknown>

beforeEach(() => {
  for (const fn of Object.values(gh)) fn.mockClear()
  state.helperPresent = false
  state.ghRoutes = runnerRoutes()
})

describe('runSdkUpgradeJob — lockfile helper', () => {
  it('helper present: pushes one bump commit, parks the job in awaiting_lockfile, opens no PR', async () => {
    state.helperPresent = true
    const { db, queries } = runnerDb()
    state.db = db

    const result = await runSdkUpgradeJob(JOB)

    expect(result).toMatchObject({ ok: true, status: 'awaiting_lockfile' })
    expect(gh.createPrFromFiles).not.toHaveBeenCalled()
    expect(gh.openPullRequestForBranch).not.toHaveBeenCalled()
    expect(gh.createBranchWithSingleCommit).toHaveBeenCalledTimes(1)
    const commit = (gh.createBranchWithSingleCommit.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(commit.baseSha).toBe('base-sha')
    expect(String(commit.branch)).toMatch(/^mushi\/sdk-upgrade-/)
    expect(String(commit.message)).toMatch(/^chore\(deps\): bump @mushi-mushi\/\* SDK packages/)
    expect((commit.files as Array<{ path: string }>).map((f) => f.path)).toEqual(['package.json'])

    const update = lastUpdate(queries)
    expect(update.status).toBe('awaiting_lockfile')
    expect(update.commit_sha).toBe('bump-sha')
    expect(update.finished_at).toBeUndefined()
    expect(update.plan).toEqual([
      expect.objectContaining({ package: '@mushi-mushi/web', to: expect.stringContaining('1.31.0'), path: 'package.json' }),
    ])
  })

  it('helper absent: opens the PR now and the body points at the lockfile helper docs', async () => {
    const { db, queries } = runnerDb()
    state.db = db

    const result = await runSdkUpgradeJob(JOB)

    expect(result).toMatchObject({ ok: true, status: 'completed', prUrl: 'https://github.com/acme/app/pull/7' })
    expect(gh.createBranchWithSingleCommit).not.toHaveBeenCalled()
    expect(gh.createPrFromFiles).toHaveBeenCalledTimes(1)
    const opts = (gh.createPrFromFiles.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(opts.title).toBe('chore: bump @mushi-mushi/* SDK packages')
    expect(opts.labels).toEqual(['mushi-sdk-upgrade'])
    const body = String(opts.body)
    expect(body).toContain(LOCKFILE_HELPER_DOCS_URL)
    expect(body.split('\n').filter((l) => l.includes(LOCKFILE_HELPER_DOCS_URL))).toHaveLength(1)
    expect(lastUpdate(queries).status).toBe('completed')
  })
})

describe('runSdkUpgradeJob — linked repo choice', () => {
  it('scans GitHub\'s default branch even when the project_repos row still says main', async () => {
    const { db } = createFakeDb((q: FakeQuery) => {
      if (q.table === 'sdk_upgrade_jobs' && q.op === 'select') {
        return { data: { id: JOB, project_id: PROJECT, status: 'queued', started_at: null } }
      }
      if (q.table === 'sdk_upgrade_jobs' && q.op === 'update') return { data: [{ id: JOB }] }
      if (q.table === 'project_repos') {
        return {
          data: [{
            repo_url: `https://github.com/${OWNER}/${REPO}`,
            role: 'frontend',
            is_primary: true,
            default_branch: 'main',
            github_app_installation_id: null,
          }],
        }
      }
      if (q.table === 'project_settings') return { data: null }
      return { data: null }
    })
    state.db = db
    state.ghRoutes = [
      [`/repos/${OWNER}/${REPO}/git/trees/`, { tree: [{ path: 'package.json', type: 'blob' }] }],
      [`/repos/${OWNER}/${REPO}/contents/package.json?ref=master`, { content: b64(JSON.stringify(PKG)) }],
      [`/repos/${OWNER}/${REPO}/contents/`, null],
      [`/repos/${OWNER}/${REPO}`, { default_branch: 'master' }],
    ]

    const result = await runSdkUpgradeJob(JOB)

    // On `main` the package.json is absent and the job would end "up to date".
    expect(result).toMatchObject({ ok: true, status: 'completed' })
    expect(gh.createPrFromFiles).toHaveBeenCalledTimes(1)
  })
})

describe('syncAwaitingLockfileJobs', () => {
  const NOW = new Date('2026-10-03T12:00:00Z')
  const awaitingJob = (minutesAgo: number) => ({
    id: JOB,
    project_id: PROJECT,
    branch: 'mushi/sdk-upgrade-abc',
    commit_sha: 'bump-sha',
    plan: [{ package: '@mushi-mushi/web', from: '^1.29.0', to: '^1.31.0', path: 'apps/web/package.json' }],
    started_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    created_at: new Date(NOW.getTime() - (minutesAgo + 1) * 60_000).toISOString(),
  })

  function sweepDb(job: Record<string, unknown>) {
    return createFakeDb((q: FakeQuery) => {
      if (q.table === 'sdk_upgrade_jobs' && q.op === 'select') return { data: [job] }
      if (q.table === 'project_settings') return { data: { github_repo_url: `https://github.com/${OWNER}/${REPO}` } }
      return { data: null }
    })
  }

  const commits = (...list: Array<{ sha: string; login?: string; message: string }>) =>
    list.map((c) => ({ sha: c.sha, author: c.login ? { login: c.login } : null, commit: { message: c.message } }))

  it('only scans jobs in awaiting_lockfile', async () => {
    const { db, queries } = sweepDb(awaitingJob(2))
    state.ghRoutes = [[`/commits?sha=`, commits({ sha: 'bump-sha', message: 'chore(deps): bump' })]]
    await syncAwaitingLockfileJobs(db, { now: NOW })
    const scan = findQueries(queries, 'sdk_upgrade_jobs', 'select')[0]
    expect(scan.filters).toContainEqual({ method: 'eq', args: ['status', 'awaiting_lockfile'] })
  })

  it('waits while the branch head is still the bump commit', async () => {
    const { db, queries } = sweepDb(awaitingJob(5))
    state.ghRoutes = [[`/commits?sha=`, commits({ sha: 'bump-sha', message: 'chore(deps): bump' })]]
    const [r] = await syncAwaitingLockfileJobs(db, { now: NOW })
    expect(r.outcome).toBe('waiting')
    expect(gh.openPullRequestForBranch).not.toHaveBeenCalled()
    expect(findQueries(queries, 'sdk_upgrade_jobs', 'update')).toHaveLength(0)
  })

  it('opens the PR once a github-actions[bot] lockfile commit sits on the bump', async () => {
    const { db, queries } = sweepDb(awaitingJob(4))
    state.ghRoutes = [
      [`/commits?sha=`, commits(
        { sha: 'lock-sha', login: 'github-actions[bot]', message: 'chore(deps): refresh lockfile for @mushi-mushi/* bump' },
        { sha: 'bump-sha', login: 'mushi-mushi[bot]', message: 'chore(deps): bump @mushi-mushi/* SDK packages' },
      )],
      [`/commits/lock-sha`, { files: [{ filename: 'pnpm-lock.yaml' }] }],
      [`/repos/${OWNER}/${REPO}`, { default_branch: 'main' }],
    ]

    const [r] = await syncAwaitingLockfileJobs(db, { now: NOW })

    expect(r).toMatchObject({ outcome: 'pr_opened', lockfile: 'refreshed', prUrl: 'https://github.com/acme/app/pull/9' })
    const opts = (gh.openPullRequestForBranch.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(opts).toMatchObject({
      base: 'main',
      branch: 'mushi/sdk-upgrade-abc',
      title: 'chore: bump @mushi-mushi/* SDK packages',
      labels: ['mushi-sdk-upgrade'],
    })
    expect(String(opts.body)).toContain('- `apps/web/package.json`')
    expect(String(opts.body)).toContain('refreshed on this branch')
    expect(String(opts.body)).not.toContain('Lockfile not refreshed')

    const update = findQueries(queries, 'sdk_upgrade_jobs', 'update')[0]
    expect(update.payload).toMatchObject({
      status: 'completed',
      release_status: 'pr_opened',
      pr_url: 'https://github.com/acme/app/pull/9',
      pr_number: 9,
      commit_sha: 'lock-sha',
    })
    // CAS: a concurrent tick cannot open a second PR for the same job.
    expect(update.filters).toContainEqual({ method: 'eq', args: ['status', 'awaiting_lockfile'] })
  })

  it('also accepts a head commit that only touches a lockfile', async () => {
    const { db } = sweepDb(awaitingJob(4))
    state.ghRoutes = [
      [`/commits?sha=`, commits(
        { sha: 'human-sha', login: 'someone', message: 'update deps' },
        { sha: 'bump-sha', message: 'chore(deps): bump' },
      )],
      [`/commits/human-sha`, { files: [{ filename: 'apps/web/package-lock.json' }] }],
      [`/repos/${OWNER}/${REPO}`, { default_branch: 'main' }],
    ]
    const [r] = await syncAwaitingLockfileJobs(db, { now: NOW })
    expect(r).toMatchObject({ outcome: 'pr_opened', lockfile: 'refreshed' })
  })

  it('opens the PR after 30 minutes without a lockfile commit, with the note', async () => {
    const { db, queries } = sweepDb(awaitingJob(LOCKFILE_WAIT_MS / 60_000 + 1))
    state.ghRoutes = [
      [`/commits?sha=`, commits({ sha: 'bump-sha', message: 'chore(deps): bump' })],
      [`/repos/${OWNER}/${REPO}`, { default_branch: 'main' }],
    ]

    const [r] = await syncAwaitingLockfileJobs(db, { now: NOW })

    expect(r).toMatchObject({ outcome: 'pr_opened', lockfile: 'timeout' })
    const body = String((gh.openPullRequestForBranch.mock.calls[0] as unknown as [Record<string, unknown>])[0].body)
    expect(body).toContain(`**Lockfile not refreshed** — add the Mushi lockfile workflow (${LOCKFILE_HELPER_DOCS_URL})`)
    expect(findQueries(queries, 'sdk_upgrade_jobs', 'update')[0].payload).toMatchObject({
      status: 'completed',
      release_status: 'pr_opened',
      commit_sha: 'bump-sha',
    })
  })

  it('fails the job when the branch cannot be read after the wait, so the upgrade slot frees up', async () => {
    const { db, queries } = sweepDb(awaitingJob(LOCKFILE_WAIT_MS / 60_000 + 1))
    state.ghRoutes = []
    const [r] = await syncAwaitingLockfileJobs(db, { now: NOW })
    expect(r.outcome).toBe('failed')
    expect(gh.openPullRequestForBranch).not.toHaveBeenCalled()
    expect(findQueries(queries, 'sdk_upgrade_jobs', 'update')[0].payload).toMatchObject({ status: 'failed' })
  })
})

describe('migration: sdk_upgrade_jobs status CHECK', () => {
  const MIGRATIONS = resolve(__dirname, '../../supabase/migrations')
  const checkList = (sql: string): string[] => {
    const m = sql.match(/sdk_upgrade_jobs_status_check[\s\S]*?CHECK\s*\(\s*status\s+IN\s*\(([\s\S]*?)\)\s*\)/i)
    expect(m, 'status CHECK not found').toBeTruthy()
    return Array.from(m![1].matchAll(/'([a-z_]+)'/g), (x) => x[1])
  }

  it('keeps every earlier status and adds awaiting_lockfile', () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    const original = checkList(readFileSync(resolve(MIGRATIONS, '20260615232827_sdk_upgrade_jobs.sql'), 'utf8'))
    const latestFile = files.filter((f) => /sdk_upgrade_jobs_status_check/.test(readFileSync(resolve(MIGRATIONS, f), 'utf8'))).at(-1)!
    expect(latestFile).toBe('20261003193000_sdk_upgrade_awaiting_lockfile.sql')
    const latest = checkList(readFileSync(resolve(MIGRATIONS, latestFile), 'utf8'))
    for (const status of original) expect(latest).toContain(status)
    expect(latest).toContain('awaiting_lockfile')
    expect(latest).toHaveLength(original.length + 1)
  })

  it('drops the constraint with IF EXISTS so it re-runs safely', () => {
    const sql = readFileSync(resolve(MIGRATIONS, '20261003193000_sdk_upgrade_awaiting_lockfile.sql'), 'utf8')
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS sdk_upgrade_jobs_status_check/)
  })
})
