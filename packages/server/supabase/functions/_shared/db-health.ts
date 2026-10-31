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

export interface DbHealth {
  grade: DbGrade
  tier: { name: string; memoryGb: number; recommendedMaxGb: number; monthlyUsd: number } | null
  sizeMb: number | null
  sizePctOfRecommended: number | null
  cacheHitPct: number | null
  connections: number | null
  maxConnections: number | null
  statsReset: string | null
  counts: { error: number; warn: number; info: number }
  top: DbIssue[]
  advice: string[]
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

export function summarizeDbHealth(advisors: readonly AdvisorResult[], stats: DbStats | null): DbHealth {
  const issues = dbIssues(advisors)
  const counts = { error: 0, warn: 0, info: 0 }
  for (const i of issues) counts[i.level === 'ERROR' ? 'error' : i.level === 'WARN' ? 'warn' : 'info'] += i.count
  const tier = stats?.maxConnections != null ? TIERS.find((t) => t.maxConnections === stats.maxConnections) ?? null : null
  const sizeMb = stats?.dbBytes != null ? Math.round(stats.dbBytes / 1_048_576) : null
  const sizePct = tier && sizeMb != null ? Math.round((sizeMb / (tier.recommendedMaxGb * 1024)) * 100) : null
  const cache = stats?.cacheHitPct ?? null
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
  if (sizePct != null && sizePct >= 70 && tier) {
    advice.push(`The database is ${sizePct}% of the ${tier.recommendedMaxGb} GB Supabase recommends for ${tier.name}: add retention to log and history tables, or plan the next tier.`)
  }
  if (connPct != null && connPct >= 70) {
    advice.push(`${stats!.connections} of ${stats!.maxConnections} connections are in use: send app and job traffic through the connection pooler.`)
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
    cacheHitPct: cache,
    connections: stats?.connections ?? null,
    maxConnections: stats?.maxConnections ?? null,
    statsReset: stats?.statsReset ?? null,
    counts,
    top: issues.slice(0, 6),
    advice: advice.slice(0, 5),
  }
}

/** The one read-only query behind DbStats: built-in counters only, no table data. */
export const DB_STATS_SQL = `select
  pg_database_size(current_database()) as db_bytes,
  current_setting('max_connections')::int as max_connections,
  (select count(*) from pg_stat_activity)::int as connections,
  (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) from pg_stat_database)::float as cache_hit_pct,
  (select stats_reset from pg_stat_database where datname = current_database()) as stats_reset`

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
  }
}
