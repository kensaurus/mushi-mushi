/**
 * FILE: verify-routes.test.ts
 * PURPOSE: The verified-fixes routes (Plan 024, ADR 0035) through the real
 *          handlers on an in-memory database:
 *            - verify-settings: GET returns the stored columns, the workflow
 *              state and the second-judge key's label (never the key); PUT
 *              is validated against the bounds, refused to viewers, audited;
 *            - GET verification, POST verify (viewers refused, closed PRs
 *              refused, 6 an hour per fix, the worker asked to re-check);
 *            - the workflow: filled YAML, and the PR that adds it (viewers
 *              refused, already installed, missing workflow permission);
 *            - `api` forwards every one of these paths to `api-ext`.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({ resolveLlmKey: async () => null }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400, extra?: Record<string, unknown>) =>
    c.json({ ok: false, error: { code, message, ...extra } }, status),
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))

type Routes = typeof import('../../supabase/functions/api/routes/verify.ts')
let routes: Routes
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  routes = await import('../../supabase/functions/api/routes/verify.ts')
})

const P = '1000000a-0000-4000-8000-000000000000'
const FIX = '3000000a-0000-4000-8000-000000000000'
const USER = '2000000a-0000-4000-8000-000000000000'
const HEAD = 'a'.repeat(40)

let db: FakeDb
const calls = {
  audit: vi.fn(),
  invoke: vi.fn(),
  rate: vi.fn(),
  openPr: vi.fn(),
  installed: vi.fn(),
  toolchain: vi.fn(),
}
let role: string | null = 'member'

function seed(tables: Record<string, Row[]> = {}) {
  db = makeFakeDb({
    project_settings: [{ project_id: P, verified_auto_merge: false, verify_runs_on: ['self-hosted', 'alienware'], verify_test_command: 'pnpm vitest run {files}' }],
    project_repos: [{ project_id: P, repo_url: 'https://github.com/acme/app', is_primary: true, default_branch: 'main', github_app_installation_id: 7 }],
    fix_attempts: [{ id: FIX, project_id: P, report_id: 'r1', pr_url: 'https://github.com/acme/app/pull/9', pr_state: 'open', merged_at: null, commit_sha: HEAD }],
    fix_merge_gates: [
      {
        id: 'g1',
        fix_attempt_id: FIX,
        head_sha: HEAD,
        base_sha: null,
        gates: [{ id: 'review', status: 'pass', label: 'Opus review: merge', detail: 'x' }],
        passed: false,
        second_judge: null,
        auto_merge_state: 'none',
        auto_merge_detail: null,
        merged_at: null,
        merge_sha: null,
        evaluated_at: '2026-10-21T10:00:00Z',
      },
    ],
    fix_regressions: [],
    ...tables,
  })
}

function app(over: Partial<Parameters<Routes['registerVerifyRoutes']>[1]> = {}) {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    await next()
  }
  const a = new Hono()
  routes.registerVerifyRoutes(a as never, {
    ...routes.defaultVerifyRouteDeps,
    getServiceClient: () => db as never,
    jwtAuth: pass as never,
    adminOrApiKeyRead: pass as never,
    adminOrApiKeyWrite: pass as never,
    callerCanAccessProject: (async () => ({ allowed: role !== null, role })) as never,
    claimRateLimit: calls.rate as never,
    logAudit: calls.audit as never,
    resolveRepoToken: async () => 'gh-token',
    workflowInstalled: calls.installed as never,
    defaultBranch: async () => 'main',
    openWorkflowPr: calls.openPr as never,
    repoToolchain: calls.toolchain as never,
    resolveSecondJudgeKey: (async () => ({ key: { key: 'sk-secret-value', source: 'byok', hint: 'alue', label: 'Team OpenAI' }, provider: 'openai', model: 'gpt-5.4' })) as never,
    invokeVerifier: calls.invoke,
    now: () => new Date('2026-10-21T12:00:00Z'),
    ...over,
  })
  return a
}

async function call(a: Hono, method: string, path: string, body?: unknown) {
  const res = await a.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, json: (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string } } }
}

beforeEach(() => {
  seed()
  role = 'member'
  calls.audit.mockReset().mockResolvedValue(undefined)
  calls.invoke.mockReset()
  calls.toolchain.mockReset().mockResolvedValue({ packageManager: null, yarnBerry: false, localSetupAction: false, runnerVariable: null })
  calls.rate.mockReset().mockResolvedValue({ allowed: true })
  calls.openPr.mockReset().mockResolvedValue({ url: 'https://github.com/acme/app/pull/12', number: 12, branch: 'mushi/verify-workflow-x' })
  calls.installed.mockReset().mockResolvedValue(false)
})

const SETTINGS = `/v1/admin/projects/${P}/verify-settings`

describe('verify-settings', () => {
  it('GET returns the stored columns, the workflow state and the key label, never the key', async () => {
    const res = await call(app(), 'GET', SETTINGS)
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({
      verified_auto_merge: false,
      verified_auto_merge_daily_limit: 5,
      verify_runs_on: ['self-hosted', 'alienware'],
      verify_test_command: 'pnpm vitest run {files}',
      verify_second_judge: 'auto',
      auto_revert: 'pr',
      workflowInstalled: false,
      secondJudgeKey: { provider: 'openai', label: 'Team OpenAI' },
      available: true,
    })
    expect(JSON.stringify(res.json)).not.toContain('sk-secret-value')
  })

  it('GET refuses a project the caller cannot read', async () => {
    role = null
    expect((await call(app(), 'GET', SETTINGS)).status).toBe(403)
  })

  it('PUT saves a valid partial body and audits it', async () => {
    const res = await call(app(), 'PUT', SETTINGS, { verified_auto_merge: true, verify_max_lines: 300, verify_protected_globs: ['src/auth/**'] })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ verified_auto_merge: true, verify_max_lines: 300, verify_protected_globs: ['src/auth/**'] })
    expect(db.table('project_settings')[0]).toMatchObject({ verified_auto_merge: true, verify_max_lines: 300 })
    expect(calls.audit).toHaveBeenCalledWith(db, P, USER, 'settings.updated', 'project_settings', P, { verifiedMerge: { verified_auto_merge: true, verify_max_lines: 300, verify_protected_globs: ['src/auth/**'] } })
  })

  it('PUT creates the settings row for an app that has none', async () => {
    seed({ project_settings: [] })
    expect((await call(app(), 'PUT', SETTINGS, { verify_runs_on: ['alienware'] })).status).toBe(200)
    expect(db.table('project_settings')[0]).toMatchObject({ project_id: P, verify_runs_on: ['alienware'] })
  })

  it.each([
    [{ verified_auto_merge_daily_limit: 51 }],
    [{ verify_runs_on: ['bad label'] }],
    [{ verify_test_command: 'no placeholder' }],
    [{ verify_max_files: 21 }],
    [{ unknown_field: 1 }],
    [{}],
  ])('PUT refuses %j', async (body) => {
    const res = await call(app(), 'PUT', SETTINGS, body)
    expect(res.status).toBe(400)
    expect(res.json.error?.code).toBe('VALIDATION_ERROR')
    expect(calls.audit).not.toHaveBeenCalled()
  })

  it('PUT names each invalid field in error.issues', async () => {
    const res = await call(app(), 'PUT', SETTINGS, { verify_max_files: 21, verify_runs_on: ['ok', 'bad label'] })
    const issues = (res.json.error as unknown as { issues: Array<{ path: string[]; message: string }> }).issues
    expect(issues.map((i) => i.path.join('.')).sort()).toEqual(['verify_max_files', 'verify_runs_on.1'])
    expect(issues.every((i) => typeof i.message === 'string' && i.message.length > 0)).toBe(true)
  })

  it('PUT is refused to viewers', async () => {
    role = 'viewer'
    expect((await call(app(), 'PUT', SETTINGS, { verified_auto_merge: true })).status).toBe(403)
    expect(db.table('project_settings')[0].verified_auto_merge).toBe(false)
  })
})

describe('verification and re-check', () => {
  it('GET returns the current head\'s gates', async () => {
    const res = await call(app(), 'GET', `/v1/admin/fixes/${FIX}/verification`)
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ headSha: HEAD, passed: false, autoMerge: { state: 'none', detail: null }, regressions: [] })
    expect(res.json.data.gates).toHaveLength(1)
  })

  it('GET 404s with NOT_FOUND before the first check', async () => {
    seed({ fix_merge_gates: [] })
    const res = await call(app(), 'GET', `/v1/admin/fixes/${FIX}/verification`)
    expect(res.status).toBe(404)
    expect(res.json.error?.code).toBe('NOT_FOUND')
  })

  it('GET shows regressions with their revert PR', async () => {
    seed({ fix_regressions: [{ id: 'x1', fix_attempt_id: FIX, signal: 'ci_failed_on_merge', detail: 'CI failed (test)', merge_sha: 'm', revert_state: 'pr_opened', revert_pr_url: 'https://github.com/acme/app/pull/3', created_at: '2026-10-21T11:00:00Z' }] })
    const res = await call(app(), 'GET', `/v1/admin/fixes/${FIX}/verification`)
    expect(res.json.data.regressions).toEqual([
      expect.objectContaining({ id: 'x1', signal: 'ci_failed_on_merge', detail: 'CI failed (test)', revertState: 'pr_opened', revertPrUrl: 'https://github.com/acme/app/pull/3', createdAt: '2026-10-21T11:00:00Z' }),
    ])
  })

  it('GET 404s an unknown fix and 403s a fix the caller cannot read', async () => {
    expect((await call(app(), 'GET', `/v1/admin/fixes/3000000a-0000-4000-8000-0000000000ff/verification`)).status).toBe(404)
    role = null
    expect((await call(app(), 'GET', `/v1/admin/fixes/${FIX}/verification`)).status).toBe(403)
  })

  it('POST asks the worker to re-check, 6 an hour per fix', async () => {
    const res = await call(app(), 'POST', `/v1/admin/fixes/${FIX}/verify`)
    expect(res.status).toBe(202)
    expect(calls.invoke).toHaveBeenCalledWith(FIX)
    expect(calls.rate).toHaveBeenCalledWith(db, `fix:${FIX}:verify_rerun`, 6, 3600)
    calls.rate.mockResolvedValue({ allowed: false, retryAfterSec: 100 })
    const limited = await call(app(), 'POST', `/v1/admin/fixes/${FIX}/verify`)
    expect(limited.status).toBe(429)
    expect(limited.json.error?.code).toBe('RATE_LIMITED')
    expect(calls.invoke).toHaveBeenCalledTimes(1)
  })

  it('POST is refused to viewers and for a closed PR', async () => {
    role = 'viewer'
    expect((await call(app(), 'POST', `/v1/admin/fixes/${FIX}/verify`)).status).toBe(403)
    role = 'member'
    seed({ fix_attempts: [{ id: FIX, project_id: P, report_id: 'r1', pr_url: 'https://github.com/acme/app/pull/9', pr_state: 'merged', merged_at: '2026-10-21T00:00:00Z', commit_sha: HEAD }] })
    expect((await call(app(), 'POST', `/v1/admin/fixes/${FIX}/verify`)).json.error?.code).toBe('PR_NOT_OPEN')
    expect(calls.invoke).not.toHaveBeenCalled()
  })
})

describe('the verify workflow', () => {
  it('GET returns the YAML with this project\'s labels and test command', async () => {
    const res = await call(app(), 'GET', `/v1/admin/projects/${P}/verify-workflow`)
    expect(res.status).toBe(200)
    expect(res.json.data.path).toBe('.github/workflows/mushi-verify.yml')
    expect(res.json.data.yaml).toContain('runs-on: [self-hosted, alienware]')
    expect(res.json.data.yaml).toContain('test-command: "pnpm vitest run {files}"')
  })

  it('POST /pr opens a PR with that YAML on the default branch', async () => {
    const res = await call(app(), 'POST', `/v1/admin/projects/${P}/verify-workflow/pr`)
    expect(res.status).toBe(201)
    expect(res.json.data).toMatchObject({ prUrl: 'https://github.com/acme/app/pull/12', prNumber: 12 })
    expect(calls.openPr.mock.calls[0][0]).toMatchObject({ token: 'gh-token', ref: { owner: 'acme', repo: 'app' }, defaultBranch: 'main' })
    expect(calls.openPr.mock.calls[0][0].yaml).toContain('runs-on: [self-hosted, alienware]')
    expect(calls.audit).toHaveBeenCalled()
  })

  it('fits the workflow to the repo: npm from its lockfile, its runner variable when the project kept the default label', async () => {
    calls.toolchain.mockResolvedValue({ packageManager: 'npm', yarnBerry: false, localSetupAction: false, runnerVariable: { name: 'LINUX_RUNNER', fallback: 'ubuntu-24.04' } })
    const res = await call(app(), 'GET', `/v1/admin/projects/${P}/verify-workflow`)
    // The project picked its own labels, so they win over the variable.
    expect(res.json.data.yaml).toContain('runs-on: [self-hosted, alienware]')
    expect(res.json.data.yaml).toContain('- run: npm ci')
    expect(res.json.data.yaml).not.toContain('pnpm install')
    expect(res.json.data.toolchain).toMatchObject({ packageManager: 'npm' })
    expect(calls.toolchain.mock.calls[0][1]).toMatchObject({ projectId: P, token: 'gh-token', ref: { owner: 'acme', repo: 'app' }, branch: 'main' })

    seed({ project_settings: [{ project_id: P, verified_auto_merge: false, verify_runs_on: ['ubuntu-latest'], verify_test_command: null }] })
    const fitted = await call(app(), 'GET', `/v1/admin/projects/${P}/verify-workflow`)
    expect(fitted.json.data.yaml).toContain("runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}")
    expect(fitted.json.data.yaml).toContain('test-command: "npx vitest run {files}"')
    await call(app(), 'POST', `/v1/admin/projects/${P}/verify-workflow/pr`)
    expect(calls.openPr.mock.calls.at(-1)[0].yaml).toContain("runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}")
  })

  it('falls back to the template when the repo cannot be read', async () => {
    calls.toolchain.mockRejectedValue(new Error('boom'))
    const res = await call(app(), 'GET', `/v1/admin/projects/${P}/verify-workflow`)
    expect(res.status).toBe(200)
    expect(res.json.data.yaml).toContain('pnpm install --frozen-lockfile')
    expect(res.json.data.toolchain).toMatchObject({ packageManager: null })
  })

  it('POST /pr refuses viewers, an installed workflow, and explains a missing workflows permission', async () => {
    role = 'viewer'
    expect((await call(app(), 'POST', `/v1/admin/projects/${P}/verify-workflow/pr`)).status).toBe(403)
    role = 'member'
    calls.installed.mockResolvedValue(true)
    expect((await call(app(), 'POST', `/v1/admin/projects/${P}/verify-workflow/pr`)).json.error?.code).toBe('ALREADY_INSTALLED')
    calls.installed.mockResolvedValue(false)
    calls.openPr.mockRejectedValue(new Error('GitHub PUT https://api.github.com/repos/acme/app/contents/x → 403: refusing to allow a GitHub App to create or update workflow'))
    const res = await call(app(), 'POST', `/v1/admin/projects/${P}/verify-workflow/pr`)
    expect(res.status).toBe(403)
    expect(res.json.error?.code).toBe('GITHUB_WORKFLOWS_WRITE_MISSING')
  })
})

describe('routing', () => {
  it('api forwards every verify path to api-ext, which registers them', () => {
    const api = readFileSync(resolve(__dirname, '../../supabase/functions/api/index.ts'), 'utf8')
    const ext = readFileSync(resolve(__dirname, '../../supabase/functions/api-ext/index.ts'), 'utf8')
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/verify.ts'), 'utf8')
    const paths = [...src.matchAll(/app\.(?:get|put|post)\('([^']+)'/g)].map((m) => m[1])
    expect(paths).toHaveLength(6)
    for (const p of paths) expect(api).toContain(`'${p}'`)
    expect(ext).toContain('registerVerifyRoutes(app)')
  })
})
