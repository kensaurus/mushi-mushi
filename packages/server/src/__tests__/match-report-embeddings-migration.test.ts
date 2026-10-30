/**
 * match_report_embeddings exact-scans every embedding in a project (the
 * project predicate is on reports, so the shared HNSW graph is not a
 * bounded project walk) and PostgREST cancels it at 8s. 20261030190000
 * keeps that scan exact through 2000 rows and, above that, uses iterative
 * HNSW on the existing index only when pgvector is 0.8 or newer.
 *
 * The previous definition (20260422050000) is SECURITY INVOKER with no
 * GRANT or REVOKE recorded. CREATE OR REPLACE keeps that mode when the
 * clause is omitted, and it does not replace the owner or EXECUTE grants.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  __dirname,
  '../../supabase/migrations/20261030190000_match_report_embeddings_project_scan.sql',
)
const migrationSql = readFileSync(migrationPath, 'utf8')
const sql = migrationSql.replace(/--[^\n]*/g, '')

describe('20261030190000_match_report_embeddings_project_scan', () => {
  it('exact-scans a project at or under 2000 embeddings', () => {
    expect(sql).toMatch(/limit 2001/)
    expect(sql).toMatch(/project_rows > 2000/)
    expect(sql).toMatch(/where r\.project_id = p_project_id/)
    expect(sql).toMatch(/\(1 - s\.distance\) > match_threshold/)
    expect(sql).toMatch(/order by s\.distance\s+limit match_count/)
  })

  it('uses iterative HNSW only after a pgvector version check, without rebuilding the index', () => {
    expect(sql).toMatch(/from pg_extension\s+where extname = 'vector'/)
    expect(sql).toMatch(/split_part\(vector_version, '\.', 1\)::int > 0/)
    expect(sql).toMatch(/split_part\(vector_version, '\.', 2\)::int >= 8/)
    expect(sql).toMatch(/set_config\('hnsw\.iterative_scan', 'relaxed_order', true\)/)
    expect(sql).toMatch(/set_config\('hnsw\.ef_search', '100', true\)/)
    expect(sql).toMatch(/set_config\('enable_seqscan', 'off', true\)/)
    expect(sql).toMatch(/r\.project_id::text = p_project_id::text/)
    expect(sql).toMatch(/re\.model = 'text-embedding-3-small'/)
    expect(sql).not.toMatch(/set hnsw\.iterative_scan/)
    expect(sql).not.toMatch(/drop index/i)
    expect(sql).not.toMatch(/add column/i)
    expect(sql).not.toMatch(/statement_timeout/i)
  })

  it('keeps the RPC signature', () => {
    expect(sql).toMatch(
      /function public\.match_report_embeddings\(\s*query_embedding vector,\s*match_threshold double precision,\s*match_count integer,\s*p_project_id uuid\s*\)/i,
    )
  })

  it('puts the saved planner settings back and warns when the HNSW list is short', () => {
    expect(sql).toMatch(/current_setting\('hnsw\.iterative_scan', true\)/)
    expect(sql).toMatch(/current_setting\('hnsw\.ef_search', true\)/)
    expect(sql).toMatch(/current_setting\('enable_seqscan', true\)/)
    expect(sql).toMatch(/set_config\('hnsw\.iterative_scan', prev_iterative_scan, true\)/)
    expect(sql).toMatch(/set_config\('hnsw\.ef_search', prev_ef_search, true\)/)
    expect(sql).toMatch(/set_config\('enable_seqscan', prev_seqscan, true\)/)
    // Failure while applying the settings, failure during the scan, and the
    // success path each write the saved values back.
    expect(sql.match(/set_config\('enable_seqscan', prev_seqscan, true\)/g)).toHaveLength(3)
    const warningAt = sql.indexOf('match_report_embeddings_hnsw_short')
    const restoreAt = sql.lastIndexOf("set_config('enable_seqscan', prev_seqscan, true)")
    expect(warningAt).toBeGreaterThan(restoreAt)
    expect(sql).toMatch(/hnsw_rows < match_count/)
  })

  it('does not restate security or grants; the previous definition is invoker', () => {
    const prior = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20260422050000_fix_match_codebase_files_search_path.sql'),
      'utf8',
    ).replace(/--[^\n]*/g, '')
    const priorFn = prior.slice(prior.toLowerCase().lastIndexOf('function public.match_report_embeddings'))
    expect(priorFn).not.toMatch(/security\s+definer/i)
    expect(sql).not.toMatch(/security\s+definer/i)
    expect(sql).not.toMatch(/\bgrant\b/i)
    expect(sql).not.toMatch(/\brevoke\b/i)
  })

  it('the Helm copy is identical', () => {
    const helm = readFileSync(
      resolve(__dirname, '../../../../deploy/helm/migrations/20261030190000_match_report_embeddings_project_scan.sql'),
      'utf8',
    )
    expect(helm).toBe(migrationSql)
  })
})
