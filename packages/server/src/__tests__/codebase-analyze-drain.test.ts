/**
 * codebase_analyze_jobs drain + worker routing.
 *
 * On 2026-10-07 every one of 53 analyze jobs (7 projects) was still 'queued':
 * the worker routed Hono '/' while Supabase hands it '/codebase-analyze-worker',
 * so every kick got a 404, and nothing drained the queue. These tests pin:
 *   - the claim is one conditional update, so a kick and the cron drain never
 *     run the same job twice;
 *   - the drain requeues jobs whose worker died and runs the oldest queued;
 *   - the migration schedules the drain, and every Hono worker routes with
 *     its function-name prefix.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type Row } from './__stubs__/fake-supabase.ts'

const wikiIngest = vi.hoisted(() => vi.fn(async () => ({ processed: 2, ready: 2, failed: 0 })))
vi.mock('../../supabase/functions/_shared/wiki-ingest.ts', () => ({
  runWikiIngestForProject: wikiIngest,
}))

// The runner's imports read Deno.env at module load.
;(globalThis as { Deno?: unknown }).Deno ??= { env: { get: (k: string) => process.env[k] } }
const runner = await import('../../supabase/functions/_shared/codebase-analyze-runner.ts')

const P = '542b34e0-019e-41fe-b900-7b637717bb86'
const NOW = Date.parse('2026-10-07T12:00:00Z')

function job(id: string, extra: Row = {}): Row {
  // wiki_ingest jobs take the short path, so the claim and drain logic is
  // exercised without building a code graph.
  return { id, project_id: P, status: 'queued', trigger: 'wiki_ingest', changed_paths: null, created_at: `2026-10-0${id.slice(-1)}T00:00:00Z`, ...extra }
}

describe('runCodebaseAnalyzeJob claim', () => {
  it('runs a queued job once and marks it completed', async () => {
    const db = makeFakeDb({ codebase_analyze_jobs: [job('job-1')] })
    const first = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(first).toMatchObject({ ok: true, status: 'completed' })
    expect(db.tables.codebase_analyze_jobs[0]).toMatchObject({ status: 'completed', error: null })

    const again = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(again).toMatchObject({ ok: true, status: 'skipped', error: 'job status completed' })
  })

  it('skips a job another caller already claimed', async () => {
    const db = makeFakeDb({ codebase_analyze_jobs: [job('job-1', { status: 'running', started_at: new Date(NOW).toISOString() })] })
    wikiIngest.mockClear()
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'skipped', error: 'job status running' })
    expect(wikiIngest).not.toHaveBeenCalled()
  })

  it('reports a missing job as failed', async () => {
    const db = makeFakeDb({ codebase_analyze_jobs: [] })
    expect(await runner.runCodebaseAnalyzeJob(db as never, 'nope')).toMatchObject({ ok: false, error: 'job not found' })
  })
})

describe('drainCodebaseAnalyzeJobs', () => {
  it('requeues stale running jobs, then runs the oldest queued up to the limit', async () => {
    const stale = new Date(NOW - 20 * 60_000).toISOString()
    const recent = new Date(NOW - 2 * 60_000).toISOString()
    const db = makeFakeDb({
      codebase_analyze_jobs: [
        job('job-4'),
        job('job-1', { status: 'running', started_at: stale }),
        job('job-2', { status: 'running', started_at: recent }),
        job('job-3'),
      ],
    })
    const summary = await runner.drainCodebaseAnalyzeJobs(db as never, { limit: 2, now: () => NOW })

    expect(summary.requeued).toBe(1)
    expect(summary.picked).toBe(2)
    // job-1 (requeued, oldest) and job-3 ran; job-4 waits for the next drain.
    expect(summary.results.map((r) => [r.jobId, r.status])).toEqual([['job-1', 'completed'], ['job-3', 'completed']])
    const byId = Object.fromEntries(db.tables.codebase_analyze_jobs.map((r) => [r.id, r.status]))
    expect(byId).toEqual({ 'job-1': 'completed', 'job-2': 'running', 'job-3': 'completed', 'job-4': 'queued' })
  })

  it('stops starting jobs once its time budget is spent', async () => {
    const db = makeFakeDb({ codebase_analyze_jobs: [job('job-1'), job('job-2')] })
    let t = NOW
    const summary = await runner.drainCodebaseAnalyzeJobs(db as never, {
      limit: 5,
      now: () => {
        const v = t
        t += 60_000
        return v
      },
    })
    expect(summary.picked).toBe(2)
    expect(summary.results.length).toBeLessThan(2)
  })

  it('reports a queue read failure instead of an empty drain', async () => {
    const db = makeFakeDb({ codebase_analyze_jobs: [job('job-1')] }, { failRead: (t) => (t === 'codebase_analyze_jobs' ? 'boom' : null) })
    const summary = await runner.drainCodebaseAnalyzeJobs(db as never, { now: () => NOW })
    expect(summary.error).toMatch(/queue read failed: boom/)
  })
})

describe('analyzeDrainLimit', () => {
  it('defaults, floors and caps the limit', () => {
    expect(runner.analyzeDrainLimit(undefined)).toBe(5)
    expect(runner.analyzeDrainLimit('x')).toBe(5)
    expect(runner.analyzeDrainLimit(0)).toBe(5)
    expect(runner.analyzeDrainLimit(3.7)).toBe(3)
    expect(runner.analyzeDrainLimit('8')).toBe(8)
    expect(runner.analyzeDrainLimit(500)).toBe(20)
  })
})

const serverRoot = resolve(__dirname, '../..')
const functionsRoot = join(serverRoot, 'supabase/functions')

describe('codebase-analyze-worker wiring', () => {
  it('schedules the drain every 10 minutes through cron_http_post', () => {
    const sql = readFileSync(join(serverRoot, 'supabase/migrations/20261007141000_codebase_analyze_drain_cron.sql'), 'utf-8')
    expect(sql).toMatch(/cron\.schedule\(\s*'mushi-codebase-analyze-drain-10m',\s*'9-59\/10 \* \* \* \*'/)
    expect(sql).toMatch(/mushi\.cron_http_post\('codebase-analyze-worker', jsonb_build_object\('trigger', 'cron', 'limit', 5\), 60000\)/)
    // The job body has no jobId, which is what selects the drain path.
    const command = /\$cmd\$([\s\S]*?)\$cmd\$/.exec(sql)?.[1] ?? ''
    expect(command).toMatch(/cron_http_post/)
    expect(command).not.toMatch(/jobId/i)
    const helm = readFileSync(resolve(serverRoot, '../../deploy/helm/migrations/20261007141000_codebase_analyze_drain_cron.sql'), 'utf-8')
    expect(helm).toBe(sql)
  })

  it('keeps the push and Re-analyze kicks alive past the response', () => {
    for (const file of ['api/routes/codebase-understand.ts', 'webhooks-github-indexer/index.ts']) {
      const src = readFileSync(join(functionsRoot, file), 'utf-8')
      const kick = src.slice(src.indexOf('/functions/v1/codebase-analyze-worker') - 200, src.indexOf('/functions/v1/codebase-analyze-worker') + 600)
      expect(kick, file).toMatch(/runInBackground\(/)
      expect(kick, file).toMatch(/if \(!res\.ok\)/)
    }
  })
})

/**
 * Supabase hands a function the path WITH its name, so a Hono app without
 * basePath must prefix every route with `/<dir>`. A bare '/' 404s every
 * call; it has now shipped in four functions.
 */
describe('Hono edge functions route with their function name', () => {
  const dirs = readdirSync(functionsRoot).filter((d) => {
    if (d.startsWith('_')) return false
    try {
      return statSync(join(functionsRoot, d, 'index.ts')).isFile()
    } catch {
      return false
    }
  })
  const honoDirs = dirs.filter((d) => /new Hono\b/.test(readFileSync(join(functionsRoot, d, 'index.ts'), 'utf-8')))

  it('finds the Hono workers (sanity check the scanner)', () => {
    expect(honoDirs).toContain('codebase-analyze-worker')
    expect(honoDirs.length).toBeGreaterThan(5)
  })

  for (const dir of honoDirs) {
    it(`${dir} prefixes its routes with /${dir}`, () => {
      const src = readFileSync(join(functionsRoot, dir, 'index.ts'), 'utf-8')
      const basePath = /new Hono[^\n]*\.basePath\(\s*['"]\/([\w-]+)['"]\s*\)/.exec(src)
      if (basePath) {
        expect(basePath[1]).toBe(dir)
        return
      }
      const routes = [...src.matchAll(/\bapp\.(?:get|post|put|patch|delete|all)\(\s*['"]([^'"]*)['"]/g)].map((m) => m[1])
      expect(routes.length, `${dir}/index.ts declares no app.<method>('…') routes`).toBeGreaterThan(0)
      for (const route of routes) {
        expect(route === `/${dir}` || route.startsWith(`/${dir}/`), `${dir}: route '${route}' must start with /${dir}`).toBe(true)
      }
    })
  }
})
