/**
 * FILE: vuln-watch-run.test.ts
 * PURPOSE: runVulnWatch end to end (ADR 0038) against the fake database, a
 *          fake GitHub and OSV / KEV / EPSS / endoflife.date answering with
 *          the real responses in fixtures/vulns:
 *          - a lodash 4.17.15 lockfile and a PHP 8.3.30 Dockerfile become
 *            two reports (source security_advisory, status classified, no
 *            model call) and a portfolio_radar_vulns run with findings;
 *          - php2shell is filed from OSV's Bitnami record plus the curated
 *            row for the CVE OSV does not have yet, with php.net's stopgaps;
 *          - fixture lockfiles are ignored, only coordinates are stored;
 *          - a second run files nothing new and reads no advisory twice;
 *          - an upgrade closes the row, a dismissal survives, the daily
 *            limit holds, and an unreadable repo is "not checked", never ok;
 *          - the routes group the rows and refuse viewers.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let watch: typeof import('../../supabase/functions/_shared/vuln-watch-db.ts')
let routes: typeof import('../../supabase/functions/api/routes/vulnerabilities.ts')
let HonoCtor: typeof import('hono').Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  watch = await import('../../supabase/functions/_shared/vuln-watch-db.ts')
  routes = await import('../../supabase/functions/api/routes/vulnerabilities.ts')
  HonoCtor = (await import('hono')).Hono
})

const P = '1000000a-0000-4000-8000-000000000000'
const R = '2000000a-0000-4000-8000-000000000000'
const SHA = 'a'.repeat(40)
const NOW = new Date('2026-10-22T12:00:00Z')
const FIX = resolve(__dirname, 'fixtures/vulns')
const fixture = (name: string) => readFileSync(resolve(FIX, name), 'utf8')

function lockfile(lodash: string) {
  return JSON.stringify({
    name: 'app',
    lockfileVersion: 3,
    packages: {
      '': { name: 'app', dependencies: { lodash: `^${lodash}` }, devDependencies: { minimist: '^1.2.5' } },
      'node_modules/lodash': { version: lodash, resolved: `https://registry.npmjs.org/lodash/-/lodash-${lodash}.tgz`, integrity: 'sha512-secret' },
      'node_modules/minimist': { version: '1.2.5', dev: true, resolved: 'https://npm.example.com/_auth=TOKEN/minimist-1.2.5.tgz' },
    },
  })
}

function repoFiles(lodash = '4.17.15'): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'app', dependencies: { lodash: `^${lodash}` }, devDependencies: { minimist: '^1.2.5' } }),
    'package-lock.json': lockfile(lodash),
    Dockerfile: 'FROM php:8.3.30-fpm\nRUN echo hi\n',
    // Ignored: fixtures are not shipped.
    'test/fixtures/old/package-lock.json': lockfile('4.17.4'),
  }
}

function seed(extra: Record<string, unknown[]> = {}): FakeDb {
  return makeFakeDb({
    projects: [{ id: P, name: 'app', owner_id: 'user-a', organization_id: 'org-a' }],
    project_repos: [{ id: R, project_id: P, is_primary: true, repo_url: 'https://github.com/o/r' }],
    project_settings: [{ project_id: P, vuln_reports_daily_limit: 10 }],
    project_codebase_files: [{ project_id: P, file_path: 'src/http.ts', content_preview: "import _ from 'lodash'\nexport const get = _.get\n", tombstoned_at: null }],
    reports: [], dependency_vulns: [], vuln_advisories: [], vuln_cve_signals: [], vuln_feed_state: [], runtime_advisories: [], gate_runs: [], gate_findings: [], vuln_watch_leases: [],
    ...extra,
  } as never, { autoId: true })
}

interface Calls { batch: number; details: string[]; kev: number; epss: number; eol: number; sent: string[] }

/** A second Bitnami record, as OSV would publish for php2shell's other CVE. */
function bit109619(): string {
  const rec = JSON.parse(fixture('osv-vuln-BIT-php-2026-109618.json'))
  rec.id = 'BIT-php-2026-109619'
  rec.aliases = ['CVE-2026-109619']
  return JSON.stringify(rec)
}

function fetcher(calls: Calls, opts: { osvKnowsBothPhpCves?: boolean } = {}) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const json = (b: unknown) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: 200 })
    if (url === 'https://api.osv.dev/v1/querybatch') {
      calls.batch++
      calls.sent.push(String(init?.body))
      const { queries } = JSON.parse(String(init?.body)) as { queries: Array<{ package: { name: string; ecosystem: string }; version: string }> }
      return json({
        results: queries.map((q) =>
          q.package.name === 'lodash' && q.version === '4.17.15' ? { vulns: [{ id: 'GHSA-35jh-r3h4-6jhm', modified: '2026-10-17T02:55:38.085813876Z' }] }
            : q.package.ecosystem === 'Bitnami' && q.package.name === 'php' && q.version === '8.3.30'
              ? { vulns: [{ id: 'BIT-php-2026-109618', modified: '2026-10-22T09:11:05.122712806Z' }, ...(opts.osvKnowsBothPhpCves ? [{ id: 'BIT-php-2026-109619', modified: '2026-10-23T01:00:00Z' }] : [])] }
              : {}),
      })
    }
    if (url.startsWith('https://api.osv.dev/v1/vulns/')) {
      const id = decodeURIComponent(url.split('/').pop()!)
      calls.details.push(id)
      return json(id === 'BIT-php-2026-109619' ? bit109619() : fixture(`osv-vuln-${id}.json`))
    }
    if (url.includes('known_exploited_vulnerabilities.json')) {
      calls.kev++
      return json(fixture('cisa-kev-sample.json'))
    }
    if (url.startsWith('https://api.first.org/data/v1/epss')) {
      calls.epss++
      return json(fixture('epss-response.json'))
    }
    if (url === 'https://endoflife.date/api/v1/products/php') {
      calls.eol++
      return json(fixture('endoflife-php-v1.json'))
    }
    return new Response('not found', { status: 404 })
  }
}

function deps(calls: Calls, files: Record<string, string>, over: Partial<import('../../supabase/functions/_shared/vuln-watch-db.ts').VulnWatchDeps> = {}) {
  return {
    resolveRepo: async () => ({ ok: true as const, repo: { ref: { owner: 'o', repo: 'r' }, token: 't', repoUrl: 'https://github.com/o/r', defaultBranchHint: 'main' } }),
    getDefaultHead: async () => ({ branch: 'main', sha: SHA }),
    listTree: async () => ({ entries: Object.keys(files).map((path) => ({ path, size: files[path].length, sha: 'b'.repeat(40) })), truncated: false }),
    readBlobs: async (_r: unknown, _s: string, paths: readonly string[]) => new Map(paths.map((p) => [p, files[p] ?? null])),
    readBlobText: async () => null,
    fetcher: fetcher(calls),
    now: () => NOW,
    ...over,
  } as never
}

const freshCalls = (): Calls => ({ batch: 0, details: [], kev: 0, epss: 0, eol: 0, sent: [] })

describe('runVulnWatch', () => {
  it('files one report per upgrade and records the radar run', async () => {
    const db = seed()
    const calls = freshCalls()
    const out = await watch.runVulnWatch(db as never, P, deps(calls, repoFiles()), 'cron')

    expect(out).toMatchObject({ status: 'fail', commitSha: SHA, lockfiles: 1, filed: 2, capped: 0 })
    // Only coordinates went to OSV; the fixture lockfile was not read.
    expect(calls.sent.join('')).not.toContain('://')
    expect(calls.sent.join('')).not.toContain('4.17.4')

    const reports = db.table('reports')
    expect(reports.map((r) => r.summary).sort()).toEqual([
      'Known security hole in lodash 4.17.15: upgrade to 4.17.21',
      'Known security holes in PHP 8.3.30: upgrade to 8.3.36',
    ])
    for (const r of reports) expect(r).toMatchObject({ project_id: P, source: 'security_advisory', status: 'classified', reporter_token_hash: 'cron:vuln-watch' })
    const lodash = reports.find((r) => String(r.summary).includes('lodash'))!
    // HIGH + EPSS 21% → high, imported in src/http.ts → critical.
    expect(lodash.severity).toBe('critical')
    expect(String(lodash.description)).toContain('src/http.ts')
    const php = reports.find((r) => String(r.summary).includes('PHP'))!
    expect(String(php.description)).toContain('BIT-php-2026-109618')
    expect(String(php.description)).toContain('MUSHI-RT-2026-php2shell')
    expect(String(php.description)).toContain('session.upload_progress.enabled=0')

    const rows = db.table('dependency_vulns')
    expect(rows.map((r) => `${r.kind} ${r.ecosystem} ${r.package_name} ${r.installed_version} ${r.advisory_id} ${r.severity}`).sort()).toEqual([
      'package npm lodash 4.17.15 GHSA-35jh-r3h4-6jhm critical',
      'runtime Bitnami php 8.3.30 BIT-php-2026-109618 high',
      'runtime runtime php 8.3.30 MUSHI-RT-2026-php2shell high',
    ])
    expect(rows.every((r) => r.report_id && r.status === 'open' && r.repo_id === R)).toBe(true)
    // Nothing but coordinates and public advisory facts is stored.
    expect(JSON.stringify(rows)).not.toMatch(/registry\.npmjs|TOKEN|sha512/)

    const run = db.table('gate_runs').find((r) => r.gate === 'portfolio_radar_vulns')!
    expect(run).toMatchObject({ project_id: P, status: 'fail', commit_sha: SHA, triggered_by: 'cron' })
    const results = (run.summary as { results: Array<{ ruleId: string; state: string }> }).results
    expect(results).toEqual([
      expect.objectContaining({ ruleId: 'known_vulnerable_dependency', state: 'finding' }),
      expect.objectContaining({ ruleId: 'runtime_end_of_life', state: 'ok' }),
    ])
    expect(db.table('gate_findings').map((f) => f.rule_id)).toEqual(['known_vulnerable_dependency', 'known_vulnerable_dependency'])
    expect(calls).toMatchObject({ batch: 1, kev: 1, epss: 1, eol: 1 })
    expect(calls.details.sort()).toEqual(['BIT-php-2026-109618', 'GHSA-35jh-r3h4-6jhm'])
  })

  it('files nothing new on the next run and reads no advisory or feed again', async () => {
    const db = seed()
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    const calls = freshCalls()
    const out = await watch.runVulnWatch(db as never, P, deps(calls, repoFiles()))
    expect(out.filed).toBe(0)
    expect(db.table('reports')).toHaveLength(2)
    expect(db.table('dependency_vulns')).toHaveLength(3)
    expect(calls.details).toEqual([])
    expect(calls.kev).toBe(0)
    expect(calls.epss).toBe(0)
  })

  it('closes a row once the upgrade lands, and never reopens a dismissed one', async () => {
    const db = seed()
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    const phpRow = db.table('dependency_vulns').find((r) => r.ecosystem === 'Bitnami')!
    phpRow.status = 'dismissed'
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles('4.17.21')))
    const rows = db.table('dependency_vulns')
    expect(rows.find((r) => r.package_name === 'lodash')).toMatchObject({ status: 'fixed', resolved_at: NOW.toISOString() })
    expect(rows.find((r) => r.ecosystem === 'Bitnami')?.status).toBe('dismissed')
  })

  it('stops at the daily limit and says so', async () => {
    const db = seed({ project_settings: [{ project_id: P, vuln_reports_daily_limit: 1 }] })
    const out = await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    expect(out).toMatchObject({ filed: 1, capped: 1 })
    expect(out.warnings.join(' ')).toContain('wait for tomorrow (limit 1 a day')
    // The worst one is filed first.
    expect(db.table('reports')[0].summary).toContain('lodash')
  })

  it('files nothing with the limit at 0, but still records the findings', async () => {
    const db = seed({ project_settings: [{ project_id: P, vuln_reports_daily_limit: 0 }] })
    const out = await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    expect(out).toMatchObject({ filed: 0, capped: 2 })
    expect(db.table('reports')).toHaveLength(0)
    expect(db.table('dependency_vulns')).toHaveLength(3)
  })

  it('is "not checked" without a repo, and "could not check" when OSV fails, never ok', async () => {
    const db = seed()
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), { resolveRepo: async () => ({ ok: false, repoConnected: false, tokenAvailable: false, reason: 'No primary GitHub repo is connected to this project.' }) }))
    const first = db.table('gate_runs')[0]
    expect(first.status).toBe('skipped')
    expect((first.summary as { results: Array<{ state: string }> }).results.map((r) => r.state)).toEqual(['unknown', 'unknown'])

    const failing = fetcher(freshCalls())
    const osvDown = { fetcher: async (url: string, init?: RequestInit) => (url.includes('querybatch') ? new Response('down', { status: 503 }) : failing(url, init)) }
    const { Dockerfile: _d, ...noRuntime } = repoFiles()
    const down = await watch.runVulnWatch(db as never, P, deps(freshCalls(), noRuntime, osvDown))
    expect(down.status).toBe('error')
    expect(db.table('reports')).toHaveLength(0)
  })

  it('still files the curated runtime hole when OSV is down, and withdraws nothing', async () => {
    const db = seed()
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    const failing = fetcher(freshCalls())
    const out = await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), {
      fetcher: async (url: string, init?: RequestInit) => (url.includes('querybatch') ? new Response('down', { status: 503 }) : failing(url, init)),
    }))
    expect(out.status).toBe('fail')
    // Rows OSV could not confirm this time stay open.
    expect(db.table('dependency_vulns').every((r) => r.status === 'open')).toBe(true)
    const run = db.table('gate_runs').at(-1)!
    expect((run.summary as { results: Array<{ ruleId: string; reason: string }> }).results[0].reason).toContain('Part of the check failed: OSV.dev did not answer')
  })

  it('never files a group a person dismissed, even after the limit goes up', async () => {
    const db = seed({ project_settings: [{ project_id: P, vuln_reports_daily_limit: 0 }] })
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    for (const r of db.table('dependency_vulns').filter((x) => x.package_name === 'lodash')) r.status = 'dismissed'
    db.table('project_settings')[0].vuln_reports_daily_limit = 10
    const out = await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    expect(out.filed).toBe(1)
    expect(db.table('reports').map((r) => r.component)).toEqual(['PHP'])
    expect(db.table('dependency_vulns').filter((r) => r.package_name === 'lodash').every((r) => r.status === 'dismissed' && r.report_id == null)).toBe(true)
    // Not on the radar either.
    const run = db.table('gate_runs').at(-1)!
    expect(db.table('gate_findings').filter((f) => f.gate_run_id === run.id).map((f) => String(f.message))).toEqual([expect.stringContaining('PHP 8.3.30')])
  })

  it('does not file the same upgrade again after a person closed its report, but files a newer one', async () => {
    const db = seed()
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    const lodashReport = db.table('reports').find((r) => r.component === 'lodash')!
    lodashReport.status = 'dismissed'
    const again = await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    expect(again.filed).toBe(0)
    expect(db.table('reports')).toHaveLength(2)

    // A newer advisory raises the target: a new report, and every open row points at it.
    const rows = db.table('dependency_vulns').filter((r) => r.package_name === 'lodash')
    const newer = { ...rows[0], id: 'row-newer', advisory_id: 'GHSA-newer', fixed_version: '4.17.23', group_key: 'package|npm|lodash|4.17.23', report_id: null }
    db.table('dependency_vulns').push(newer)
    const calls = freshCalls()
    const base = fetcher(calls)
    const newerAdvisory = JSON.parse(fixture('osv-vuln-GHSA-35jh-r3h4-6jhm.json'))
    newerAdvisory.id = 'GHSA-newer'
    newerAdvisory.aliases = ['CVE-2026-200001']
    newerAdvisory.affected[0].ranges[0].events = [{ introduced: '0' }, { fixed: '4.17.23' }]
    const out = await watch.runVulnWatch(db as never, P, deps(calls, repoFiles(), {
      fetcher: async (url: string, init?: RequestInit) => {
        if (url.endsWith('/v1/querybatch')) {
          const res = await base(url, init)
          const body = await res.json() as { results: Array<{ vulns?: Array<{ id: string; modified: string }> }> }
          for (const r of body.results) if (r.vulns?.some((v) => v.id === 'GHSA-35jh-r3h4-6jhm')) r.vulns.push({ id: 'GHSA-newer', modified: 'x' })
          return new Response(JSON.stringify(body))
        }
        if (url.endsWith('/v1/vulns/GHSA-newer')) return new Response(JSON.stringify(newerAdvisory))
        return base(url, init)
      },
    }))
    expect(out.filed).toBe(1)
    const fresh = db.table('reports').at(-1)!
    expect(fresh.summary).toBe('Known security holes in lodash 4.17.15: upgrade to 4.17.23')
    expect(db.table('dependency_vulns').filter((r) => r.package_name === 'lodash' && r.status === 'open').every((r) => r.report_id === fresh.id)).toBe(true)
  })

  it('closes rows whose lockfile or runtime pin is gone, and curated rows OSV now covers', async () => {
    const db = seed()
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    // npm → pnpm: package-lock.json is deleted; the Dockerfile no longer pins PHP.
    const { 'package-lock.json': _lock, ...rest } = repoFiles()
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), { ...rest, Dockerfile: 'FROM node:22-alpine\n' }))
    expect(db.table('dependency_vulns').map((r) => `${r.package_name} ${r.ecosystem} ${r.status}`).sort()).toEqual([
      'lodash npm fixed',
      'php Bitnami fixed',
      'php runtime fixed',
    ])

    const db2 = seed()
    await watch.runVulnWatch(db2 as never, P, deps(freshCalls(), repoFiles()))
    await watch.runVulnWatch(db2 as never, P, deps(freshCalls(), repoFiles(), { fetcher: fetcher(freshCalls(), { osvKnowsBothPhpCves: true }) }))
    const curated = db2.table('dependency_vulns').find((r) => r.ecosystem === 'runtime')!
    expect(curated.status).toBe('withdrawn')
    expect(db2.table('dependency_vulns').filter((r) => r.ecosystem === 'Bitnami' && r.status === 'open').map((r) => r.advisory_id).sort()).toEqual(['BIT-php-2026-109618', 'BIT-php-2026-109619'])
  })

  it('closes nothing from a lockfile the package cap cut short', async () => {
    const db = seed()
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    // Packages sort by name: a cap of 1 keeps lodash and leaves minimist out, so the lockfile was read only in part.
    const out = await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles('4.17.21'), { maxPackages: 1 }))
    expect(out.warnings.join(' ')).toContain('the first 1 were checked')
    expect(db.table('dependency_vulns').find((r) => r.package_name === 'lodash')?.status).toBe('open')
  })

  it('runs once at a time: the lease is held for the run and released after it, even when it throws', async () => {
    // vuln_watch_claim / vuln_watch_release as migration 20261022120346 defines them, on the fake's table.
    let clock = NOW.getTime()
    const db = seed({ vuln_watch_leases: [] })
    const leases = db.table('vuln_watch_leases')
    ;(db.options as { rpc?: unknown }).rpc = (fn: string, args: Record<string, unknown>) => {
      if (fn === 'vuln_watch_claim') {
        const held = leases.find((l) => l.project_id === args.p_project_id)
        if (held && Date.parse(String(held.claimed_until)) > clock) return null
        const runId = crypto.randomUUID()
        const row = { project_id: args.p_project_id, run_id: runId, claimed_until: new Date(clock + Number(args.p_ttl_seconds) * 1000).toISOString() }
        if (held) Object.assign(held, row)
        else leases.push(row)
        return runId
      }
      if (fn === 'vuln_watch_release') {
        const i = leases.findIndex((l) => l.project_id === args.p_project_id && l.run_id === args.p_run_id)
        if (i >= 0) leases.splice(i, 1)
      }
      return null
    }
    const leased = { lease: watch.dbRunLease }

    // A second run while the first holds the project files nothing; the first files once.
    let second: Awaited<ReturnType<typeof watch.runVulnWatch>> | null = null
    const first = await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), {
      ...leased,
      getDefaultHead: async () => {
        expect(await watch.leaseHeldUntil(db as never, P, new Date(clock))).not.toBeNull()
        second = await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), leased))
        return { branch: 'main', sha: SHA }
      },
    }))
    expect(second!.status).toBe('already_running')
    expect(first.filed).toBe(2)
    expect(db.table('reports')).toHaveLength(2)
    // Released when the run ended: the next check runs right away.
    expect(leases).toHaveLength(0)
    expect((await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), leased))).status).not.toBe('already_running')

    // A run that throws still releases.
    await expect(watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), { ...leased, listTree: async () => { throw new Error('boom') } }))).resolves.toMatchObject({ status: 'error' })
    await expect(watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), { ...leased, readBlobs: async () => { throw new Error('boom') } }))).resolves.toBeTruthy()
    expect(leases).toHaveLength(0)

    // A lease left by a run that died expires.
    leases.push({ project_id: P, run_id: 'dead', claimed_until: new Date(clock + 60_000).toISOString() })
    expect((await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), leased))).status).toBe('already_running')
    clock += 61_000
    expect((await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), { ...leased, now: () => new Date(clock) }))).status).not.toBe('already_running')
  })

  it('refuses the run when the lease cannot be taken (fails closed)', async () => {
    const db = makeFakeDb({ ...{} } as never, { rpcError: (fn) => (fn === 'vuln_watch_claim' ? { code: 'XX000', message: 'db down' } : null) })
    await expect(watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles(), { lease: watch.dbRunLease }))).rejects.toThrow(/could not take the run lease: db down/)
  })

  it('answers not_set_up before the migration', async () => {
    const failing = makeFakeDb({} as never, { failRead: (t) => (t === 'dependency_vulns' ? { code: '42P01', message: 'relation "public.dependency_vulns" does not exist' } : null) })
    const out = await watch.runVulnWatch(failing as never, P, deps(freshCalls(), repoFiles()))
    expect(out.status).toBe('not_set_up')
  })
})

describe('vulnerability routes', () => {
  function app(db: FakeDb, role: string | null = 'owner') {
    const invoked: string[] = []
    const a = new HonoCtor()
    a.use('*', async (c, next) => {
      c.set('userId' as never, 'user-a' as never)
      await next()
    })
    routes.registerVulnerabilityRoutes(a as never, {
      ...routes.defaultVulnRouteDeps,
      getServiceClient: () => db as never,
      jwtAuth: async (_c, next) => next(),
      adminOrApiKeyRead: async (_c, next) => next(),
      adminOrApiKeyWrite: async (_c, next) => next(),
      callerCanAccessProject: (async () => ({ allowed: true, role })) as never,
      claimRateLimit: (async () => ({ allowed: true })) as never,
      logAudit: (async () => null) as never,
      invokeWatch: (id: string) => invoked.push(id),
      now: () => NOW,
    })
    return { a, invoked }
  }

  it('lists one group per upgrade, worst first, and dismisses a group', async () => {
    const db = seed()
    await watch.runVulnWatch(db as never, P, deps(freshCalls(), repoFiles()))
    const { a } = app(db)
    const res = await a.request(`/v1/admin/projects/${P}/vulnerabilities`)
    const body = await res.json() as { data: { available: boolean; groups: Array<{ package: string; severity: string; target: string; advisories: unknown[]; reportId: string | null }>; counts: Record<string, number>; dailyLimit: number; lastRun: { lockfiles: string[] } } }
    expect(body.data.available).toBe(true)
    expect(body.data.groups.map((g) => [g.package, g.severity, g.target, g.advisories.length])).toEqual([
      ['lodash', 'critical', '4.17.21', 1],
      ['php', 'high', '8.3.36', 2],
    ])
    expect(body.data.groups.every((g) => g.reportId)).toBe(true)
    expect(body.data.counts).toMatchObject({ critical: 1, high: 1 })
    expect(body.data.lastRun.lockfiles).toEqual(['package-lock.json'])

    const groupKey = db.table('dependency_vulns').find((r) => r.package_name === 'lodash')!.group_key
    const patch = await a.request(`/v1/admin/projects/${P}/vulnerabilities/groups`, { method: 'PATCH', body: JSON.stringify({ groupKey, status: 'dismissed', reason: 'not reachable' }) })
    expect(patch.status).toBe(200)
    expect(db.table('dependency_vulns').find((r) => r.package_name === 'lodash')).toMatchObject({ status: 'dismissed', dismissed_reason: 'not reachable', dismissed_by: 'user-a' })
  })

  it('starts a check, saves the limit, and refuses viewers', async () => {
    const db = seed()
    const { a, invoked } = app(db)
    expect((await a.request(`/v1/admin/projects/${P}/vulnerabilities/scan`, { method: 'POST' })).status).toBe(202)
    expect(invoked).toEqual([P])
    expect((await a.request(`/v1/admin/projects/${P}/vulnerabilities/settings`, { method: 'PUT', body: JSON.stringify({ dailyLimit: 3 }) })).status).toBe(200)
    expect(db.table('project_settings')[0].vuln_reports_daily_limit).toBe(3)
    expect((await a.request(`/v1/admin/projects/${P}/vulnerabilities/settings`, { method: 'PUT', body: JSON.stringify({ dailyLimit: 500 }) })).status).toBe(400)

    // While a check holds the project, Check now says so instead of a 202 that starts nothing.
    db.table('vuln_watch_leases').push({ project_id: P, run_id: 'r', claimed_until: new Date(NOW.getTime() + 90_000).toISOString() })
    const busy = await a.request(`/v1/admin/projects/${P}/vulnerabilities/scan`, { method: 'POST' })
    expect(busy.status).toBe(409)
    expect(busy.headers.get('Retry-After')).toBe('90')
    expect(((await busy.json()) as { error: { code: string } }).error.code).toBe('RUN_IN_PROGRESS')
    expect(invoked).toEqual([P])

    const viewer = app(db, 'viewer').a
    expect((await viewer.request(`/v1/admin/projects/${P}/vulnerabilities/scan`, { method: 'POST' })).status).toBe(403)
    expect((await viewer.request(`/v1/admin/projects/${P}/vulnerabilities/groups`, { method: 'PATCH', body: JSON.stringify({ groupKey: 'x|y|z|1', status: 'dismissed' }) })).status).toBe(403)
  })
})
