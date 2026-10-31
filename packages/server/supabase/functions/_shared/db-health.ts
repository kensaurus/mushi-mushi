/**
 * FILE: packages/server/supabase/functions/_shared/db-health.ts
 * PURPOSE: One app's database health in plain words, for the console's
 *          Database health card (2026-10-31: the owner asked to see the
 *          health and the advice for every Supabase project from Mushi).
 *          Pure: the route reads the advisors and one stats query through the
 *          app's read-only Supabase token, and this turns them into a grade,
 *          the top issues and what to do.
 *
 * Tier limits are Supabase's own table (docs/guides/platform/compute-and-disk,
 * read 2026-10-31): the tier is inferred from max_connections, which Supabase
 * sets per tier, because the read-only token cannot read the compute add-on.
 */

import type { AdvisorResult } from './supabase-mcp-client.ts'

export interface DbStats {
  dbBytes: number | null
  maxConnections: number | null
  connections: number | null
  cacheHitPct: number | null
  statsReset: string | null
  /** When Postgres last started: right after a restart the cache is still filling. */
  startedAt: string | null
}

export type DbGrade = 'good' | 'watch' | 'act'

export interface DbIssue {
  name: string
  title: string
  level: 'ERROR' | 'WARN' | 'INFO'
  category: 'security' | 'performance' | 'other'
  count: number
  remediation: string | null
}

/** Where the database spends its time and space (one read-only catalog query each). */
export interface DbHotspots {
  /** Top statements by total time since the stats reset; null when pg_stat_statements is unreadable. */
  slow: Array<{ label: string; query: string; calls: number; meanMs: number; pct: number }> | null
  /** When the statement counters started (a restart or reset clears them). */
  slowSince: string | null
  tables: Array<{ name: string; bytes: number; rows: number; dead: number }>
  unusedIndexes: Array<{ name: string; table: string; bytes: number }>
}

export interface DbHealth {
  grade: DbGrade
  tier: { name: string; memoryGb: number; recommendedMaxGb: number; monthlyUsd: number } | null
  sizeMb: number | null
  sizePctOfRecommended: number | null
  cacheHitPct: number | null
  connections: number | null
  maxConnections: number | null
  statsReset: string | null
  startedAt: string | null
  counts: { error: number; warn: number; info: number }
  top: DbIssue[]
  advice: string[]
  hotspots: DbHotspots | null
}

/** Supabase compute tiers by max_connections (Nano and Micro share 60). */
const TIERS: ReadonlyArray<{ maxConnections: number; name: string; memoryGb: number; recommendedMaxGb: number; monthlyUsd: number }> = [
  { maxConnections: 60, name: 'Micro', memoryGb: 1, recommendedMaxGb: 10, monthlyUsd: 10 },
  { maxConnections: 90, name: 'Small', memoryGb: 2, recommendedMaxGb: 50, monthlyUsd: 15 },
  { maxConnections: 120, name: 'Medium', memoryGb: 4, recommendedMaxGb: 100, monthlyUsd: 60 },
  { maxConnections: 160, name: 'Large', memoryGb: 8, recommendedMaxGb: 200, monthlyUsd: 110 },
  { maxConnections: 240, name: 'XL', memoryGb: 16, recommendedMaxGb: 500, monthlyUsd: 210 },
]

const LEVEL_RANK: Record<DbIssue['level'], number> = { ERROR: 0, WARN: 1, INFO: 2 }

function level(raw: string | undefined): DbIssue['level'] {
  const l = (raw ?? '').toUpperCase()
  return l === 'ERROR' ? 'ERROR' : l === 'WARN' || l === 'WARNING' ? 'WARN' : 'INFO'
}

function category(a: AdvisorResult): DbIssue['category'] {
  const cats = a.metadata?.categories
  const list = Array.isArray(cats) ? cats.map((c) => String(c).toUpperCase()) : []
  if (list.includes('SECURITY')) return 'security'
  if (list.includes('PERFORMANCE')) return 'performance'
  return 'other'
}

/** One row per lint: a lint may come back once per finding or once with a count. */
export function dbIssues(advisors: readonly AdvisorResult[]): DbIssue[] {
  const byName = new Map<string, DbIssue>()
  for (const a of advisors) {
    if (!a.name) continue
    const count = typeof a.metadata?.count === 'number' ? a.metadata.count : Array.isArray(a.metadata?.findings) ? a.metadata.findings.length || 1 : 1
    const remediation = typeof a.metadata?.remediation === 'string' ? a.metadata.remediation : null
    const prev = byName.get(a.name)
    if (prev) {
      prev.count += count
      continue
    }
    byName.set(a.name, { name: a.name, title: a.title || a.name.replace(/_/g, ' '), level: level(a.level), category: category(a), count, remediation })
  }
  return [...byName.values()].sort((x, y) => LEVEL_RANK[x.level] - LEVEL_RANK[y.level] || y.count - x.count)
}

/** Tables whose rows pile up over time unless something deletes them. */
const GROWING_TABLE = /(^|_)(logs?|events?|history|audit|runs?|spans?|messages?|snapshots?|deliveries|activity|metrics?|traces?|jobs?)($|_)/i

/** Supabase-managed schemas: their size counts, but retention there is not the app's call. */
const MANAGED_SCHEMA = /^(auth|storage|realtime|supabase_functions|extensions|graphql|vault|net|cron|pgsodium|supabase_migrations)\./

function mb(bytes: number): string {
  const m = bytes / 1_048_576
  return m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${Math.round(m)} MB`
}

interface AdviceContext {
  tier: (typeof TIERS)[number] | null
  cache: number | null
  sizePct: number | null
  connPct: number | null
  /** Days of statement counters (pg_stat_statements): query share and step-down. */
  statsDays: number | null
  /** Days of table and index counters (pg_stat_database): idx_scan resets with these. */
  indexDays: number | null
}

/**
 * Advice from where the time and space go: one query eating the database,
 * a log-like table with no retention, dead rows waiting for vacuum, indexes
 * nothing reads, and a tier bigger than the load needs.
 */
function hotspotAdvice(h: DbHotspots, dbBytes: number | null, ctx: AdviceContext): string[] {
  const out: string[] = []
  // A share only means something once the counters have seen real traffic.
  const hog = h.slow?.find((q) => q.pct >= 20 && q.calls >= 100)
  if (hog) {
    out.push(
      `One query takes ${hog.pct}% of database time (${hog.meanMs} ms on average, ${hog.calls.toLocaleString('en-US')} calls): index what it filters on, cache its result, or call it less. It leads "Where database time goes".`,
    )
  }
  if (dbBytes) {
    const growing = h.tables.find(
      (t) => !MANAGED_SCHEMA.test(t.name) && GROWING_TABLE.test(t.name.split('.').pop() ?? '') && t.bytes / dbBytes >= 0.15,
    )
    if (growing) {
      out.push(
        `${growing.name} holds ${mb(growing.bytes)} (${Math.round((growing.bytes / dbBytes) * 100)}% of the database) and looks like a table that only grows: keep the last 30–90 days and delete the rest on a schedule.`,
      )
    }
  }
  const bloated = h.tables.find((t) => t.dead >= 10_000 && t.dead > t.rows * 0.2)
  if (bloated) {
    out.push(`${bloated.name} has ${bloated.dead.toLocaleString('en-US')} dead rows waiting for vacuum: run VACUUM on it, and lower its autovacuum threshold if they keep coming back.`)
  }
  const unusedBytes = h.unusedIndexes.reduce((sum, i) => sum + i.bytes, 0)
  if (unusedBytes >= 50 * 1_048_576 && (ctx.indexDays == null || ctx.indexDays >= 7)) {
    const k = h.unusedIndexes.length
    out.push(`${k} index${k === 1 ? '' : 'es'} (${mb(unusedBytes)}) ${k === 1 ? 'has' : 'have'} not been read since the stats reset: each one slows writes and takes cache. Drop the ones no feature needs.`)
  }
  // Step down only when every signal says the tier is idle, over at least a week.
  const t = ctx.tier
  const lower = t ? TIERS[TIERS.indexOf(t) - 1] : undefined
  const slowest = h.slow?.[0]?.meanMs ?? null
  if (
    t && lower && ctx.cache != null && ctx.cache >= 99.5 && ctx.sizePct != null && ctx.sizePct < 10 &&
    (ctx.connPct ?? 0) < 40 && slowest != null && slowest < 50 && (ctx.statsDays ?? 0) >= 7
  ) {
    out.push(
      `${t.name} has room to spare: ${ctx.cache}% of reads come from memory, the data is ${ctx.sizePct}% of the recommended size and the busiest query averages ${slowest} ms. ${lower.name} would save about $${t.monthlyUsd - lower.monthlyUsd}/mo if the load stays like this.`,
    )
  }
  return out
}

export function summarizeDbHealth(
  advisors: readonly AdvisorResult[],
  stats: DbStats | null,
  hotspots: DbHotspots | null = null,
  now: Date = new Date(),
): DbHealth {
  const issues = dbIssues(advisors)
  const counts = { error: 0, warn: 0, info: 0 }
  for (const i of issues) counts[i.level === 'ERROR' ? 'error' : i.level === 'WARN' ? 'warn' : 'info'] += i.count
  const tier = stats?.maxConnections != null ? TIERS.find((t) => t.maxConnections === stats.maxConnections) ?? null : null
  const sizeMb = stats?.dbBytes != null ? Math.round(stats.dbBytes / 1_048_576) : null
  const sizePct = tier && sizeMb != null ? Math.round((sizeMb / (tier.recommendedMaxGb * 1024)) * 100) : null
  // Within a day of a restart the cache is still filling: a low read-rate
  // then says nothing about the tier, so it is neither graded nor advised on.
  const startedMs = stats?.startedAt ? Date.parse(stats.startedAt) : NaN
  const warming = Number.isFinite(startedMs) && now.getTime() - startedMs < 86_400_000
  const cache = warming ? null : stats?.cacheHitPct ?? null
  const connPct = stats?.connections != null && stats.maxConnections ? Math.round((stats.connections / stats.maxConnections) * 100) : null

  const advice: string[] = []
  if (counts.error > 0) {
    const errs = issues.filter((i) => i.level === 'ERROR').map((i) => i.title.toLowerCase())
    advice.push(`Fix the ${counts.error} error${counts.error === 1 ? '' : 's'} first: ${errs.slice(0, 2).join(', ')}.`)
  }
  if (cache != null && cache < 99) {
    const next = tier ? TIERS[TIERS.indexOf(tier) + 1] : undefined
    advice.push(
      `Only ${cache}% of reads come from memory, so busy queries wait on disk. Index or trim the slowest reads${
        next ? `; if that is not enough, ${next.name} (${next.memoryGb} GB, about $${next.monthlyUsd}/mo) doubles the cache` : ''
      }.`,
    )
  }
  if (warming && stats?.cacheHitPct != null && stats.cacheHitPct < 99) {
    advice.push(`The database restarted ${new Date(startedMs).toISOString().slice(0, 16).replace('T', ' ')} UTC, so ${stats.cacheHitPct}% of reads from memory is the cache still filling. Mushi grades it again after a day.`)
  }
  if (sizePct != null && sizePct >= 70 && tier) {
    advice.push(`The database is ${sizePct}% of the ${tier.recommendedMaxGb} GB Supabase recommends for ${tier.name}: add retention to log and history tables, or plan the next tier.`)
  }
  if (connPct != null && connPct >= 70) {
    advice.push(`${stats!.connections} of ${stats!.maxConnections} connections are in use: send app and job traffic through the connection pooler.`)
  }
  if (hotspots) {
    // The two counter families reset separately: statements with
    // pg_stat_statements, idx_scan with the database counters. A null reset
    // means never reset, so the server start is the next best bound.
    const days = (since: string | null | undefined) => {
      const at = since ? Date.parse(since) : NaN
      return Number.isFinite(at) ? Math.floor((now.getTime() - at) / 86_400_000) : null
    }
    const statsDays = days(hotspots.slowSince)
    const indexDays = days(stats?.statsReset ?? stats?.startedAt)
    advice.push(...hotspotAdvice(hotspots, stats?.dbBytes ?? null, { tier, cache, sizePct, connPct, statsDays, indexDays }))
  }
  const perf = issues.filter((i) => i.category === 'performance' && i.level !== 'INFO').slice(0, 2)
  for (const p of perf) advice.push(`${p.title} (${p.count}): see the fix link.`)
  if (advice.length === 0) advice.push('Nothing needs attention. Mushi checks again on every visit.')

  const grade: DbGrade =
    counts.error > 0 || (cache != null && cache < 97) || (sizePct != null && sizePct >= 90)
      ? 'act'
      : counts.warn > 0 || (cache != null && cache < 99) || (sizePct != null && sizePct >= 70) || (connPct != null && connPct >= 70)
        ? 'watch'
        : 'good'

  return {
    grade,
    tier: tier ? { name: tier.name, memoryGb: tier.memoryGb, recommendedMaxGb: tier.recommendedMaxGb, monthlyUsd: tier.monthlyUsd } : null,
    sizeMb,
    sizePctOfRecommended: sizePct,
    cacheHitPct: stats?.cacheHitPct ?? null,
    connections: stats?.connections ?? null,
    maxConnections: stats?.maxConnections ?? null,
    statsReset: stats?.statsReset ?? null,
    startedAt: stats?.startedAt ?? null,
    counts,
    top: issues.slice(0, 6),
    advice: advice.slice(0, 6),
    hotspots,
  }
}

/** The one read-only query behind DbStats: built-in counters only, no table data. */
export const DB_STATS_SQL = `select
  pg_database_size(current_database()) as db_bytes,
  current_setting('max_connections')::int as max_connections,
  (select count(*) from pg_stat_activity)::int as connections,
  (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) from pg_stat_database)::float as cache_hit_pct,
  (select stats_reset from pg_stat_database where datname = current_database()) as stats_reset,
  pg_postmaster_start_time() as started_at`

export function parseDbStats(rows: unknown): DbStats | null {
  const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined
  if (!row) return null
  const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
  return {
    dbBytes: num(row.db_bytes),
    maxConnections: num(row.max_connections),
    connections: num(row.connections),
    cacheHitPct: num(row.cache_hit_pct),
    statsReset: typeof row.stats_reset === 'string' ? row.stats_reset : null,
    startedAt: typeof row.started_at === 'string' ? row.started_at : null,
  }
}

/** Biggest tables and never-read indexes: catalog counters only, no table data. */
export const DB_SPACE_SQL = `select
  (select coalesce(json_agg(t), '[]'::json) from (
    select n.nspname || '.' || c.relname as name, pg_total_relation_size(c.oid)::bigint as bytes,
      greatest(c.reltuples, 0)::bigint as rows, coalesce(st.n_dead_tup, 0)::bigint as dead
    from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_stat_user_tables st on st.relid = c.oid
    where c.relkind in ('r', 'p', 'm') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    order by pg_total_relation_size(c.oid) desc limit 5) t) as tables,
  (select coalesce(json_agg(t), '[]'::json) from (
    select s.schemaname || '.' || s.indexrelname as name, s.relname as table_name, pg_relation_size(s.indexrelid)::bigint as bytes
    from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid
    where s.idx_scan = 0 and not i.indisunique and not i.indisprimary and pg_relation_size(s.indexrelid) > 8388608
      and s.schemaname not in ('auth', 'storage', 'realtime', 'supabase_functions', 'extensions', 'graphql', 'vault', 'net', 'cron', 'pgsodium', 'supabase_migrations')
    order by 3 desc limit 8) t) as unused`

/**
 * The app's own statements by total time (pg_stat_statements: normalized text,
 * no parameter values). `authenticator` is left out: as itself it only runs
 * PostgREST's schema-cache introspection, which tops the list after every
 * restart; the app's requests run as anon / authenticated / service_role.
 * Mushi's own health reads are left out too.
 */
export const DB_SLOW_SQL = `select (select stats_reset from extensions.pg_stat_statements_info) as since,
  (select coalesce(json_agg(t), '[]'::json) from (
    select left(regexp_replace(s.query, '[[:space:]]+', ' ', 'g'), 600) as query, s.calls::bigint as calls,
      round(s.mean_exec_time::numeric, 1)::float as mean_ms,
      round((100 * s.total_exec_time / nullif(sum(s.total_exec_time) over (), 0))::numeric, 1)::float as pct
    from extensions.pg_stat_statements s join pg_roles r on r.oid = s.userid
    where r.rolname in ('authenticated', 'anon', 'service_role', 'postgres')
      and s.query !~* '^[[:space:]]*(begin|commit|rollback|set|show|deallocate|listen)'
      and s.query !~* 'pg_stat_statements|pg_total_relation_size|pg_stat_database'
      and s.query <> '<insufficient privilege>'
    order by s.total_exec_time desc limit 5) t) as slow`

function jsonList(v: unknown): Array<Record<string, unknown>> {
  let parsed = v
  if (typeof v === 'string') {
    try {
      parsed = JSON.parse(v)
    } catch {
      parsed = null
    }
  }
  return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : []
}

/** `"schema"."name"`, `schema.name` or `"name"`; group 1 is the name. */
const IDENT = String.raw`(?:"?\w+"?\.)?"?(\w+)"?`
/** PostgREST RPC: `… "public"."fn"("a" := pgrst_body."a") pgrst_call`. */
const RPC_CALL = new RegExp(String.raw`${IDENT}\s*\([^()]*\)\s*pgrst_call`, 'i')
const PGRST_WRITE = new RegExp(String.raw`^WITH pgrst_source AS \(\s*(INSERT INTO|UPDATE|DELETE FROM) ${IDENT}`, 'i')
const PGRST_READ = new RegExp(String.raw`^WITH pgrst_source AS \(\s*SELECT .*? FROM ${IDENT}`, 'i')
const FN_CALL = new RegExp(String.raw`^SELECT\s+${IDENT}\s*\(`, 'i')
const WRITE_VERB: Record<string, string> = { 'INSERT INTO': 'insert into', UPDATE: 'update', 'DELETE FROM': 'delete from' }

/**
 * A statement as a person reads it. PostgREST wraps every request in
 * `WITH pgrst_source AS (…)`, so the raw text starts the same for every
 * table; the label names the RPC or the table and what is done to it.
 *
 * @internal Exported for tests only.
 */
export function queryLabel(query: string): string {
  const q = query.replace(/\s+/g, ' ').trim()
  const rpc = q.match(RPC_CALL)
  if (rpc) return `${rpc[1]}() (RPC)`
  const write = q.match(PGRST_WRITE)
  if (write) return `${WRITE_VERB[write[1].toUpperCase()]} ${write[2]}`
  const read = q.match(PGRST_READ)
  if (read) return `read ${read[1]}`
  const call = q.match(FN_CALL)
  if (call) return `${call[1]}()`
  return q.length > 80 ? `${q.slice(0, 77)}…` : q
}

const num0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** The two hotspot reads in one shape; a failed slow read stays null so the card can say so. */
export function parseDbHotspots(spaceRows: unknown, slowRows: unknown): DbHotspots | null {
  const space = Array.isArray(spaceRows) ? (spaceRows[0] as Record<string, unknown> | undefined) : undefined
  if (!space) return null
  const slowRow = Array.isArray(slowRows) ? (slowRows[0] as Record<string, unknown> | undefined) : undefined
  return {
    slow: slowRow
      ? jsonList(slowRow.slow).map((r) => {
          const query = String(r.query ?? '')
          return { label: queryLabel(query), query: query.slice(0, 160), calls: num0(r.calls), meanMs: num0(r.mean_ms), pct: num0(r.pct) }
        })
      : null,
    slowSince: typeof slowRow?.since === 'string' ? slowRow.since : null,
    tables: jsonList(space.tables).map((r) => ({ name: String(r.name ?? ''), bytes: num0(r.bytes), rows: num0(r.rows), dead: num0(r.dead) })),
    unusedIndexes: jsonList(space.unused).map((r) => ({ name: String(r.name ?? ''), table: String(r.table_name ?? ''), bytes: num0(r.bytes) })),
  }
}
