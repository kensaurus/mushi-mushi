/**
 * FILE: repo-routes-console.test.ts
 * PURPOSE: /repo console QA group C, against the real route module.
 *
 *   #20   Marking a second repo primary always failed on the one-primary
 *         unique index. The route now moves the flag.
 *   #97   The API allowed a role list that did not match the DB CHECK:
 *         mobile/ai/infra silently became "monorepo" (add) or were dropped
 *         (edit), and "library" was accepted but violates the CHECK.
 *   #98   Branches and Merged were hard-coded to 0.
 *   #99   "Open failing CI" linked to a tab that does not exist.
 *   #243  /repo/stats and /repo/overview counted the same rows differently.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'
import {
  PROJECT_REPO_ROLES,
  classifyRepoBranch,
  countRepoBranches,
} from '../../supabase/functions/_shared/repo-branch-counts.ts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const P = '1000000f-0000-4000-8000-000000000000'
const USER = '2000000f-0000-4000-8000-000000000000'
const R1 = '3000000f-0000-4000-8000-000000000001'
const R2 = '3000000f-0000-4000-8000-000000000002'

let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/entitlements.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next() }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/github-branch.ts', () => ({
  resolveBranchForConnect: async (o: { requested?: string }) => ({ branch: o.requested || 'main' }),
}))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    callerCanAccessProject: async () => ({ allowed: true }),
    callerProjectIds: async () => [P],
    resolveOwnedProject: async () => ({ project: { id: P, name: 'App' } }),
  }
})

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerQueryFixesRepoRoutes } = await import('../../supabase/functions/api/routes/query-fixes-repo.ts')
  app = new Hono()
  registerQueryFixesRepoRoutes(app as never)
})

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

function repo(id: string, url: string, primary: boolean): Row {
  return { id, project_id: P, repo_url: url, role: 'frontend', is_primary: primary, created_at: '2026-10-01' }
}

describe('#20 moving the primary repo', () => {
  beforeEach(() => {
    db = makeFakeDb(
      { project_repos: [repo(R1, 'https://github.com/o/web', true), repo(R2, 'https://github.com/o/api', false)] },
      // UNIQUE (project_id, repo_url). The one-primary index is checked by
      // asserting the end state: exactly one primary row.
      { autoId: true, uniques: { project_repos: ['project_id', 'repo_url'] } },
    )
  })

  it('a failed add never costs the project its current primary', async () => {
    const res = await call('POST', '/v1/admin/repo/repos', {
      projectId: P,
      repoUrl: 'https://github.com/o/web',
      role: 'frontend',
      isPrimary: true,
    })
    expect(res.status).toBe(409)
    expect(res.json.error.message).toBe('That repo is already linked to this project.')
    expect(db.tables.project_repos.filter((r) => r.is_primary).map((r) => r.id)).toEqual([R1])
  })

  it('a failed edit never costs the project its current primary', async () => {
    const res = await call('PUT', '/v1/admin/repo/repos/3000000f-0000-4000-8000-0000000000ff', { projectId: P, isPrimary: true })
    expect(res.status).not.toBe(200)
    expect(db.tables.project_repos.filter((r) => r.is_primary).map((r) => r.id)).toEqual([R1])
  })

  it('edit: marking the second repo primary unsets the first', async () => {
    const res = await call('PUT', `/v1/admin/repo/repos/${R2}`, { projectId: P, isPrimary: true })
    expect(res.status).toBe(200)
    const primaries = db.tables.project_repos.filter((r) => r.is_primary).map((r) => r.id)
    expect(primaries).toEqual([R2])
  })

  it('add: a new primary repo takes the flag', async () => {
    const res = await call('POST', '/v1/admin/repo/repos', {
      projectId: P,
      repoUrl: 'https://github.com/o/mobile',
      role: 'mobile',
      isPrimary: true,
    })
    expect(res.status).toBe(200)
    const primaries = db.tables.project_repos.filter((r) => r.is_primary).map((r) => r.repo_url)
    expect(primaries).toEqual(['https://github.com/o/mobile'])
  })
})

describe('#97 repo roles', () => {
  beforeEach(() => {
    db = makeFakeDb({ project_repos: [repo(R1, 'https://github.com/o/web', true)] }, { autoId: true })
  })

  it('match the project_repos CHECK exactly', () => {
    const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20260418001900_multi_repo_fixes.sql'), 'utf8')
    const m = /role\s+TEXT NOT NULL\s+CHECK \(role IN \(([^)]+)\)\)/.exec(sql)
    const allowed = (m?.[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, ''))
    expect([...PROJECT_REPO_ROLES].sort()).toEqual(allowed.sort())
  })

  it('saves mobile, ai and infra as chosen', async () => {
    for (const role of ['mobile', 'ai', 'infra']) {
      const res = await call('POST', '/v1/admin/repo/repos', { projectId: P, repoUrl: `https://github.com/o/${role}`, role })
      expect(res.status).toBe(200)
      expect(res.json.data.role).toBe(role)
    }
    const edit = await call('PUT', `/v1/admin/repo/repos/${R1}`, { projectId: P, role: 'infra' })
    expect(edit.json.data.role).toBe('infra')
  })

  it('refuses a role the database would reject, in plain English', async () => {
    const res = await call('POST', '/v1/admin/repo/repos', { projectId: P, repoUrl: 'https://github.com/o/lib', role: 'library' })
    expect(res.status).toBe(400)
    expect(res.json.error.message).toContain('"library" is not a repo role')
    const edit = await call('PUT', `/v1/admin/repo/repos/${R1}`, { projectId: P, role: 'library' })
    expect(edit.status).toBe(400)
    expect(db.tables.project_repos.find((r) => r.id === R1)?.role).toBe('frontend')
  })
})

describe('repo branch counting rule', () => {
  it('classifies merged, failed-before-PR, CI failing, CI passing, open and closed', () => {
    expect(classifyRepoBranch({ pr_url: 'u', merged_at: '2026-10-01' })).toBe('merged')
    expect(classifyRepoBranch({ pr_url: 'u', pr_state: 'merged' })).toBe('merged')
    expect(classifyRepoBranch({ status: 'failed' })).toBe('failed')
    expect(classifyRepoBranch({ pr_url: 'u', check_run_conclusion: 'action_required' })).toBe('ci_failed')
    expect(classifyRepoBranch({ pr_url: 'u', check_run_conclusion: 'cancelled' })).toBe('open')
    expect(classifyRepoBranch({ pr_url: 'u', check_run_conclusion: 'success' })).toBe('ci_passing')
    expect(classifyRepoBranch({ pr_url: 'u', pr_state: 'closed' })).toBe('closed')
  })

  it('never counts a merged PR as open or failing', () => {
    const c = countRepoBranches([
      { branch: 'a', pr_url: 'u', pr_state: 'merged', merged_at: 'x', check_run_conclusion: 'failure' },
      { branch: 'b', pr_url: 'u', check_run_conclusion: 'failure' },
      { branch: 'b', pr_url: 'u2', check_run_conclusion: 'success' },
      { branch: null, status: 'failed' },
    ])
    expect(c).toEqual({ total: 4, totalBranches: 2, prOpen: 2, ciPassing: 1, ciFailed: 1, merged: 1, failedToOpen: 1 })
  })
})

describe('#98 #99 #243 one set of numbers on /repo', () => {
  beforeEach(() => {
    const attempts: Row[] = [
      { id: 'f1', report_id: 'r1', branch: 'fix/1', status: 'completed', pr_url: 'https://github.com/o/web/pull/1', pr_state: 'merged', merged_at: '2026-10-02', check_run_conclusion: 'success', created_at: '2026-10-04T01:00:00Z' },
      { id: 'f2', report_id: 'r2', branch: 'fix/2', status: 'completed', pr_url: 'https://github.com/o/web/pull/2', pr_state: 'open', check_run_conclusion: 'action_required', created_at: '2026-10-04T02:00:00Z' },
      { id: 'f3', report_id: 'r3', branch: 'fix/3', status: 'completed', pr_url: 'https://github.com/o/web/pull/3', pr_state: 'open', check_run_conclusion: 'success', created_at: '2026-10-04T03:00:00Z' },
      { id: 'f4', report_id: 'r4', branch: null, status: 'failed', pr_url: null, created_at: '2026-10-04T04:00:00Z' },
    ].map((a) => ({ ...a, project_id: P }))
    db = makeFakeDb({
      fix_attempts: attempts,
      project_repos: [{ ...repo(R1, 'https://github.com/o/web', true), github_app_installation_id: 7 }],
      project_settings: [{ project_id: P }],
      project_integrations: [],
      project_codebase_files: [],
      reports: [],
    })
  })

  it('stats and overview count the same rows the same way', async () => {
    const stats = (await call('GET', '/v1/admin/repo/stats')).json.data
    const overview = (await call('GET', `/v1/admin/repo/overview?project_id=${P}`)).json.data
    expect(stats).toMatchObject({ totalBranches: 3, prOpen: 2, ciPassing: 1, ciFailed: 1, merged: 1, failedToOpen: 1 })
    expect(overview.counts).toMatchObject({
      open: stats.prOpen,
      ci_passing: stats.ciPassing,
      ci_failed: stats.ciFailed,
      merged: stats.merged,
      failed_to_open: stats.failedToOpen,
      branches: stats.totalBranches,
    })
    expect(overview.branches.map((b: Row) => b.bucket)).toEqual(['failed', 'ci_passing', 'ci_failed', 'merged'])
  })

  it('"Open failing CI" opens the branch list on its CI-failing filter', async () => {
    const stats = (await call('GET', '/v1/admin/repo/stats')).json.data
    expect(stats.topPriority).toBe('ci_failing')
    expect(stats.topPriorityTo).toBe('/repo?tab=branches&status=ci_failed')
  })
})
