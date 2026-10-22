/**
 * FILE: modernization-dispatch-routes.test.ts
 * PURPOSE: `POST /v1/admin/modernization/:id/dispatch` and the findings list,
 *          against the real route module:
 *            - a finding with no report gets one (library_modernizer source,
 *              plain-English text), is linked, then dispatched once;
 *            - `{ group: 'minor' }` sends every pending minor/patch finding of
 *              the repo as ONE report and one job; majors stay out;
 *            - made-up versions and major anchors for a group are refused;
 *            - a finding whose report is fixed is resolved, never re-sent.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-0000000000a1'
const USER = '2000000a-0000-4000-8000-0000000000a1'
const REPO = '3000000a-0000-4000-8000-0000000000a1'

let db: FakeDb
const invokeFixWorker = vi.fn(async () => {})

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
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock('../../supabase/functions/api/helpers.ts', () => ({
  canManageProjectSdkConfig: vi.fn(),
  coerceSdkConfigUpdate: vi.fn(),
  ingestReport: vi.fn(),
  invokeFixWorker: (id: string) => invokeFixWorker(id),
  normalizeSdkConfig: vi.fn(),
  triggerClassification: vi.fn(),
}))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    callerCanAccessProject: async () => ({ allowed: true }),
    scopedOwnedProjectIds: async () => [P],
  }
})

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerModernizationHealthSuperRoutes } = await import('../../supabase/functions/api/routes/modernization-health-super.ts')
  app = new Hono()
  registerModernizationHealthSuperRoutes(app as never)
})

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

function finding(id: string, over: Row = {}): Row {
  return {
    id,
    project_id: P,
    repo_id: REPO,
    dep_name: `pkg-${id}`,
    current_version: '^1.2.0',
    suggested_version: '1.4.0',
    manifest_path: 'package.json',
    summary: 'Bug fixes.',
    severity: 'minor',
    changelog_url: null,
    related_report_id: null,
    status: 'pending',
    detected_at: '2026-10-20T00:00:00Z',
    ...over,
  }
}

function seed(findings: Row[], extra: Record<string, Row[]> = {}) {
  db = makeFakeDb(
    {
      modernization_findings: findings,
      project_settings: [{ project_id: P, autofix_enabled: true }],
      project_repos: [{ id: REPO, project_id: P, repo_url: 'https://github.com/kensaurus/glot.it' }],
      reports: [],
      fix_dispatch_jobs: [],
      ...extra,
    },
    { autoId: true },
  )
}

beforeEach(() => invokeFixWorker.mockClear())

describe('dispatching a finding with no report', () => {
  it('files a report, links it, and dispatches through the normal path', async () => {
    seed([finding('f1', { dep_name: 'left-pad', changelog_url: 'https://github.com/o/left-pad/releases' })])
    const res = await call('POST', '/v1/admin/modernization/f1/dispatch')
    expect(res.status).toBe(200)
    expect(db.tables.reports).toHaveLength(1)
    const report = db.tables.reports[0]
    expect(report).toMatchObject({ project_id: P, source: 'library_modernizer', status: 'classified', summary: 'Update left-pad from ^1.2.0 to 1.4.0' })
    expect(String(report.description)).toContain('kensaurus/glot.it')
    expect(String(report.description)).toContain('https://github.com/o/left-pad/releases')
    expect(String(report.description)).toContain('build + typecheck + tests pass')
    const f = db.tables.modernization_findings[0]
    expect(f.related_report_id).toBe(report.id)
    expect(f.status).toBe('dispatched')
    expect(db.tables.fix_dispatch_jobs).toHaveLength(1)
    expect(db.tables.fix_dispatch_jobs[0]).toMatchObject({ report_id: report.id, status: 'queued' })
    expect(res.json.data.reportId).toBe(report.id)
    expect(invokeFixWorker).toHaveBeenCalledTimes(1)
  })

  it('a second press reuses the report and the queued job', async () => {
    seed([finding('f1')])
    await call('POST', '/v1/admin/modernization/f1/dispatch')
    // The finding is now dispatched with a report; a second press dedupes.
    const again = await call('POST', '/v1/admin/modernization/f1/dispatch')
    expect(again.status).toBe(200)
    expect(again.json.data.deduplicated).toBe(true)
    expect(db.tables.reports).toHaveLength(1)
    expect(db.tables.fix_dispatch_jobs).toHaveLength(1)
  })

  it('refuses a made-up or downgrade version without filing anything', async () => {
    seed([finding('f1', { current_version: '^10.45.0', suggested_version: '10.x latest' }), finding('f2', { current_version: '^15.0.2', suggested_version: '^14.0.4' })])
    for (const id of ['f1', 'f2']) {
      const res = await call('POST', `/v1/admin/modernization/${id}/dispatch`)
      expect(res.status).toBe(400)
      expect(res.json.error.code).toBe('VERSION_UNVERIFIED')
    }
    expect(db.tables.reports).toHaveLength(0)
    expect(db.tables.fix_dispatch_jobs).toHaveLength(0)
  })

  it('still needs auto-fix on', async () => {
    seed([finding('f1')], { project_settings: [{ project_id: P, autofix_enabled: false }] })
    const res = await call('POST', '/v1/admin/modernization/f1/dispatch')
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('AUTOFIX_DISABLED')
    expect(db.tables.reports).toHaveLength(0)
  })
})

describe("group: 'minor'", () => {
  it('sends every pending minor/patch finding of the repo as one report and one job', async () => {
    seed([
      finding('a', { dep_name: 'zod', current_version: '^3.22.0', suggested_version: '3.25.0' }),
      finding('b', { dep_name: 'hono', current_version: '^4.1.0', suggested_version: '4.13.7' }),
      finding('c', { dep_name: 'react', current_version: '^18.2.0', suggested_version: '19.0.0', severity: 'major' }),
      finding('d', { dep_name: 'vite', repo_id: 'other-repo' }),
      finding('e', { dep_name: 'sentry', current_version: '^10.45.0', suggested_version: '10.x latest' }),
    ])
    const res = await call('POST', '/v1/admin/modernization/a/dispatch', { group: 'minor' })
    expect(res.status).toBe(200)
    expect(db.tables.reports).toHaveLength(1)
    const report = db.tables.reports[0]
    expect(report.summary).toBe('Bump 2 minor dependencies in kensaurus/glot.it')
    expect(String(report.description)).toContain('- hono in package.json: ^4.1.0 → 4.13.7')
    expect(String(report.description)).toContain('- zod in package.json: ^3.22.0 → 3.25.0')
    expect(String(report.description)).not.toContain('react')
    const byId = Object.fromEntries(db.tables.modernization_findings.map((f) => [f.id, f]))
    for (const id of ['a', 'b']) expect(byId[id]).toMatchObject({ related_report_id: report.id, status: 'dispatched' })
    for (const id of ['c', 'd', 'e']) expect(byId[id]).toMatchObject({ related_report_id: null, status: 'pending' })
    expect(db.tables.fix_dispatch_jobs).toHaveLength(1)
    expect(db.tables.fix_dispatch_jobs[0].dispatch_metadata).toMatchObject({ trigger: 'manual', group: 'minor', findings: 2 })
    expect(res.json.data.findingIds.sort()).toEqual(['a', 'b'])
  })

  it('a major anchor is never grouped', async () => {
    seed([finding('c', { current_version: '^18.2.0', suggested_version: '19.0.0', severity: 'major' })])
    const res = await call('POST', '/v1/admin/modernization/c/dispatch', { group: 'minor' })
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('NOT_MINOR')
    expect(db.tables.reports).toHaveLength(0)
  })

  it('only "minor" is a valid group', async () => {
    seed([finding('a')])
    const res = await call('POST', '/v1/admin/modernization/a/dispatch', { group: 'all' })
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('reconciliation', () => {
  it('a finding whose report is fixed is resolved, not dispatched again', async () => {
    seed([finding('f1', { related_report_id: 'rep-1', severity: 'major' })], { reports: [{ id: 'rep-1', project_id: P, status: 'fixed' }] })
    const res = await call('POST', '/v1/admin/modernization/f1/dispatch')
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('ALREADY_FIXED')
    expect(db.tables.fix_dispatch_jobs).toHaveLength(0)
    expect(db.tables.modernization_findings[0].status).toBe('resolved')
  })

  it('the list resolves fixed findings before reading pending ones', async () => {
    seed(
      [
        finding('f1', { related_report_id: 'rep-1' }),
        finding('f2', { related_report_id: 'rep-2' }),
        finding('f3'),
      ],
      { reports: [{ id: 'rep-1', project_id: P, status: 'fixed' }, { id: 'rep-2', project_id: P, status: 'fixing' }] },
    )
    const res = await call('GET', '/v1/admin/modernization')
    expect(res.status).toBe(200)
    expect(res.json.data.findings.map((f: Row) => f.id).sort()).toEqual(['f2', 'f3'])
    expect(db.tables.modernization_findings.find((f) => f.id === 'f1')?.status).toBe('resolved')
    // Idempotent: a second read changes nothing more.
    const again = await call('GET', '/v1/admin/modernization')
    expect(again.json.data.findings).toHaveLength(2)
  })
})
