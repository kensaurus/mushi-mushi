/**
 * FILE: packages/server/src/__tests__/cost-audit-2026-11.test.ts
 * PURPOSE: Contracts from the 2026-11-11 cost audit that only show up as a
 *          bill: idle per-minute crons calling edge functions, and the
 *          legacy 1536-d codebase embedding being written and read.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS = resolve(__dirname, '../../supabase/migrations')
const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const migration = (name: string) => readFileSync(resolve(MIGRATIONS, name), 'utf8')
const fn = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p)
  }
  return out
}

describe('per-minute edge crons fire only when there is work', () => {
  const sql = migration('20261111091825_cron_edge_work_gates.sql')

  it('keeps both jobs every minute and guards each call with its work check', () => {
    expect(sql).toContain("jobname = 'mushi-plugin-dispatch-retry'")
    expect(sql).toContain("jobname = 'qa-story-runner-tick'")
    expect(sql).toContain("where mushi.plugin_dispatch_retry_has_work();")
    expect(sql).toContain("where mushi.qa_story_runner_has_work(now());")
    // cron.alter_job changes only the command: the schedule stays '* * * * *'.
    expect(sql).not.toMatch(/schedule\s*:=/)
  })

  it('checks plugin retries with the same predicate the claim RPC uses', () => {
    for (const clause of [
      "d.status = 'pending'",
      'd.next_retry_at is not null',
      'd.next_retry_at <= now()',
      "(d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')",
    ]) {
      expect(sql).toContain(clause)
    }
  })

  it('checks QA stories the way the runner does, and never skips a run it would make', () => {
    // Null schedule is */15 in the runner too; unknown cron syntax fires.
    expect(sql).toContain("coalesce(s.schedule_cron, '*/15 * * * *')")
    expect(fn('qa-story-runner/index.ts')).toContain("s.schedule_cron ?? '*/15 * * * *'")
    expect(sql).toMatch(/else true\s+end/)
    // Abandoned manual runs: same 10 minutes as ABANDONED_MANUAL_RUN_MS.
    expect(sql).toContain("r.started_at < p_now - interval '10 minutes'")
    expect(fn('qa-story-runner/abandoned-runs.ts')).toContain('ABANDONED_MANUAL_RUN_MS = 10 * 60 * 1000')
  })

  it('qa-story-runner answers an idle call before writing a cron_runs row', () => {
    const src = fn('qa-story-runner/index.ts')
    const idle = src.indexOf('if (dueStories.length === 0)')
    const started = src.indexOf("const cronRun = await startCronRun(db, 'qa-story-runner', 'cron')")
    expect(idle).toBeGreaterThan(0)
    expect(started).toBeGreaterThan(idle)
  })

  it('the QA tick checks and sends one minute, and the runner matches against it', async () => {
    const tickSql = migration('20261111094933_qa_story_runner_tick_minute.sql')
    expect(tickSql).toContain("jsonb_build_object('trigger', 'cron', 'tick', date_trunc('minute', now()))")
    expect(tickSql).toContain("where mushi.qa_story_runner_has_work(date_trunc('minute', now()));")
    expect(fn('qa-story-runner/index.ts')).toContain('const matchAt = cronTickTime(body.tick, now)')
    expect(fn('qa-story-runner/index.ts')).toContain("cronMatches(s.schedule_cron ?? '*/15 * * * *', matchAt)")

    const { cronTickTime } = await import('../../supabase/functions/qa-story-runner/cron-tick.ts')
    const now = new Date('2026-11-11T09:50:20Z')
    // Delivered 80 s late: still the minute pg_cron checked.
    expect(cronTickTime('2026-11-11T09:49:00+00:00', now).toISOString()).toBe('2026-11-11T09:49:00.000Z')
    // Missing, unreadable, too old or too far ahead: the arrival time.
    expect(cronTickTime(undefined, now)).toBe(now)
    expect(cronTickTime('not a time', now)).toBe(now)
    expect(cronTickTime('2026-11-11T09:30:00Z', now)).toBe(now)
    expect(cronTickTime('2026-11-11T09:55:00Z', now)).toBe(now)
  })

  it('the Health page does not call a gated job stale on a quiet day', () => {
    const health = fn('api/routes/health.ts')
    expect(health).toMatch(/ON_DEMAND_JOBS = new Set\(\['plugin-dispatch-retry', 'qa-story-runner'\]\)/)
    expect(health).toMatch(/staleness = ON_DEMAND_JOBS\.has\(job\)\s*\?\s*'ok'/)
    // The cron_runs job names the gated functions record.
    expect(fn('plugin-dispatch-retry/index.ts')).toContain("startCronRun(db, 'plugin-dispatch-retry', 'cron')")
    expect(fn('qa-story-runner/index.ts')).toContain("startCronRun(db, 'qa-story-runner', 'cron')")
  })

  it('the work checks are not callable from the API', () => {
    expect(sql).toContain('revoke all on function mushi.qa_story_runner_has_work(timestamptz) from public, anon, authenticated;')
    expect(sql).toContain('revoke all on function mushi.plugin_dispatch_retry_has_work() from public, anon, authenticated;')
  })
})

describe('the Realtime publication carries only tables a client listens to', () => {
  const sql = migration('20261111092636_realtime_publication_trim.sql')
  const ADMIN = resolve(__dirname, '../../../../apps/admin/src')
  const REMOVED = /array\[([\s\S]*?)\]/.exec(sql)![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1))

  function adminSources(dir: string): string[] {
    const out: string[] = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) out.push(...adminSources(p))
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
    }
    return out
  }

  it('removes nine tables, cron_runs among them', () => {
    expect(REMOVED).toHaveLength(9)
    expect(REMOVED).toContain('cron_runs')
    expect(REMOVED).toContain('integration_health_history')
  })

  it('no console page subscribes to a removed table (it would silently never fire)', () => {
    // A subscription names its table within a few lines of the hook call or
    // in NAV_COUNT_TABLES (useNavCounts.ts).
    const hook = /(useRealtime|useRealtimeReload|useStagedRealtime)\(|postgres_changes|NAV_COUNT_TABLES = \[/g
    for (const file of adminSources(ADMIN)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(hook)) {
        const window = src.slice(m.index!, m.index! + (m[0].startsWith('NAV_COUNT_TABLES') ? 2_000 : 400))
        for (const t of REMOVED) expect(window, `${file} subscribes to ${t}`).not.toContain(`'${t}'`)
      }
    }
  })

  it('the Health page polls cron health instead', () => {
    const page = readFileSync(resolve(ADMIN, 'pages/HealthPage.tsx'), 'utf8')
    expect(page).toContain('useVisiblePolling(reloadAll, CRON_POLL_MS)')
  })
})

describe('the legacy 1536-d codebase embedding is neither written nor read', () => {
  const only768 = migration('20261111134117_codebase_embedding_768_only.sql')
  const drop = migration('20261111134118_drop_legacy_codebase_embedding.sql')

  it('upsert_codebase_chunks writes embedding_768 from the same payload and never `embedding`', () => {
    const insertCols = /insert into public\.project_codebase_files as existing \(([\s\S]*?)\)\s*select/.exec(only768)
    expect(insertCols).not.toBeNull()
    expect(insertCols![1]).toContain('embedding_768')
    expect(insertCols![1]).not.toMatch(/\bembedding\b(?!_)/)
    // Reduced the way the trigger did it: first 768 dims, L2-normalized, half precision.
    expect(only768).toContain('extensions.subvector(r.embedding::text::extensions.vector(1536), 1, 768)')
    expect(only768).toContain('embedding_768 = coalesce(excluded.embedding_768, existing.embedding_768)')
    expect(only768).toContain("set statement_timeout to '30s'")
    expect(only768).toContain('grant execute on function public.upsert_codebase_chunks(jsonb) to service_role;')
  })

  it('the trigger no longer nulls embedding_768 on an insert without `embedding`', () => {
    expect(only768).toMatch(/if new\.embedding is not null then[\s\S]*?end if;/)
  })

  it('the drop refuses to lose a search vector and removes the trigger first', () => {
    expect(drop).toMatch(/embedding is not null\s+and embedding_768 is null/)
    const trig = drop.indexOf('drop trigger if exists trg_codebase_embedding_768')
    const col = drop.indexOf('alter table public.project_codebase_files drop column if exists embedding;')
    expect(trig).toBeGreaterThan(0)
    expect(col).toBeGreaterThan(trig)
    expect(drop).toContain("set lock_timeout = '5s'")
  })

  it('no edge code writes project_codebase_files directly or filters on `embedding`', () => {
    for (const file of walk(FUNCTIONS)) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/from\('project_codebase_files'\)\s*\.(upsert|insert)\(/)
      expect(src, file).not.toMatch(/\.not\('embedding',/)
    }
  })

  it('the console and CLI uploads go through upsert_codebase_chunks with the file imports', () => {
    for (const rel of ['api/routes/codebase.ts', 'api/routes/sync.ts']) {
      const src = fn(rel)
      expect(src, rel).toContain('upsertCodebaseChunks(db, [')
      expect(src, rel).toContain('extractRelativeImports(safeSource)')
    }
  })
})

describe('telemetry retention (owner-approved 2026-11-11)', () => {
  const sql = migration('20261111100647_telemetry_retention_30d.sql')

  it('never keeps less than 30 days, deletes in batches, and runs daily', () => {
    expect(sql).toContain('make_interval(days => greatest(p_days, 30))')
    for (const [table, col] of [
      ['integration_health_history', 'checked_at'],
      ['webhook_audit_log', 'created_at'],
      ['pipeline_runs', 'started_at'],
    ]) {
      const batched = String.raw`delete from public\.${table}\s+where id in \(\s*select id from public\.${table}\s+where ${col} < v_cutoff\s+limit p_batch`
      expect(sql).toMatch(new RegExp(batched))
    }
    expect(sql).toContain("cron.schedule('mushi-telemetry-retention', '53 5 * * *', $cmd$select mushi.prune_telemetry();$cmd$)")
    expect(sql).toContain('revoke all on function mushi.prune_telemetry(integer, integer, integer) from public, anon, authenticated;')
    // Statements only (the header comment says it does not run one).
    expect(sql.replace(/--[^\n]*/g, '')).not.toMatch(/vacuum\s+full/i)
  })
})
