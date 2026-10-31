/**
 * FILE: db-health.test.ts
 * PURPOSE: The console's Database health card (2026-10-31): one app's
 *          Supabase advisors and built-in stats as a grade, the top issues and
 *          plain advice. Tier limits follow Supabase's compute table.
 */
import { describe, expect, it } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const { dbIssues, parseDbStats, summarizeDbHealth } = await import('../../supabase/functions/_shared/db-health.ts')
const { sqlRows } = await import('../../supabase/functions/_shared/supabase-mcp-client.ts')

const lint = (name: string, level: string, count: number, cat: string, remediation = `https://supabase.com/docs/${name}`) => ({
  name,
  title: name.replace(/_/g, ' '),
  description: '',
  level,
  metadata: { count, categories: [cat], remediation },
})

const MICRO = { dbBytes: 2_147 * 1_048_576, maxConnections: 60, connections: 41, cacheHitPct: 99.41, statsReset: '2026-10-30T20:26:00Z' }

describe('dbIssues', () => {
  it('merges repeated lints, orders errors first then by count, and keeps the fix link', () => {
    const issues = dbIssues([
      lint('unindexed_foreign_keys', 'INFO', 104, 'PERFORMANCE'),
      lint('auth_rls_initplan', 'WARN', 44, 'PERFORMANCE'),
      lint('security_definer_view', 'ERROR', 1, 'SECURITY'),
      lint('auth_rls_initplan', 'WARN', 6, 'PERFORMANCE'),
    ])
    expect(issues.map((i) => [i.name, i.count])).toEqual([
      ['security_definer_view', 1],
      ['auth_rls_initplan', 50],
      ['unindexed_foreign_keys', 104],
    ])
    expect(issues[0]).toMatchObject({ level: 'ERROR', category: 'security', remediation: 'https://supabase.com/docs/security_definer_view' })
  })
})

describe('summarizeDbHealth', () => {
  it('a security error means act, and the advice leads with it', () => {
    const h = summarizeDbHealth([lint('security_definer_view', 'ERROR', 1, 'SECURITY')], MICRO)
    expect(h.grade).toBe('act')
    expect(h.advice[0]).toMatch(/^Fix the 1 error first: security definer view/)
    expect(h.tier).toMatchObject({ name: 'Micro', memoryGb: 1, recommendedMaxGb: 10 })
    expect(h.sizeMb).toBe(2147)
    expect(h.sizePctOfRecommended).toBe(21)
  })

  it('a low cache hit is watch, and names the next tier with its price', () => {
    const h = summarizeDbHealth([], { ...MICRO, connections: 10, cacheHitPct: 98.2 })
    expect(h.grade).toBe('watch')
    expect(h.advice.join(' ')).toMatch(/98.2% of reads come from memory.*Small \(2 GB, about \$15\/mo\)/)
  })

  it('a database near the tier limit, or connections near the cap, gets its own advice', () => {
    const big = summarizeDbHealth([], { ...MICRO, dbBytes: 9.5 * 1024 * 1_048_576, connections: 10, cacheHitPct: 99.9 })
    expect(big.grade).toBe('act')
    expect(big.advice.join(' ')).toMatch(/95% of the 10 GB Supabase recommends for Micro/)
    const busy = summarizeDbHealth([], { ...MICRO, connections: 50, cacheHitPct: 99.9 })
    expect(busy.advice.join(' ')).toMatch(/50 of 60 connections are in use/)
  })

  it('nothing wrong is good, with an honest line, and unreadable stats stay null', () => {
    expect(summarizeDbHealth([], { ...MICRO, connections: 10, cacheHitPct: 99.9 })).toMatchObject({ grade: 'good', advice: ['Nothing needs attention. Mushi checks again on every visit.'] })
    const blind = summarizeDbHealth([lint('auth_rls_initplan', 'WARN', 3, 'PERFORMANCE')], null)
    expect(blind).toMatchObject({ grade: 'watch', tier: null, sizeMb: null, cacheHitPct: null })
  })
})

describe('reading the stats rows', () => {
  it('parses the hosted MCP shapes into rows, then into stats', () => {
    const rows = [{ db_bytes: '2251292672', max_connections: 60, connections: 41, cache_hit_pct: 99.41, stats_reset: '2026-10-30 20:26:00+00' }]
    const wrapped = { result: `Below is the result.\n<untrusted-data-abc>\n${JSON.stringify(rows)}\n</untrusted-data-abc>\nUse this data.` }
    expect(sqlRows(wrapped)).toEqual(rows)
    expect(sqlRows(JSON.stringify(rows))).toEqual(rows)
    expect(sqlRows(rows)).toEqual(rows)
    expect(sqlRows({ result: 'no rows here' })).toEqual([])
    expect(parseDbStats(sqlRows(wrapped))).toMatchObject({ dbBytes: 2251292672, maxConnections: 60, connections: 41, cacheHitPct: 99.41 })
    expect(parseDbStats([])).toBeNull()
  })
})
