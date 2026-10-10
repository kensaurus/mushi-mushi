/**
 * release_stats_totals() (20261010180000) replaces the paged read of every
 * release behind GET /v1/admin/releases/stats. The route reads its keys by
 * name, so the SQL must return each of them, stay service-role only, and
 * scope every subquery to the one project.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261010180000_release_stats_totals.sql'),
  'utf8',
)
const route = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/releases.ts'), 'utf8')

describe('20261010180000_release_stats_totals', () => {
  it('returns every key the route reads', () => {
    const keys = [...route.matchAll(/t\.(\w+) \?\? 0/g)].map((m) => m[1])
    expect(keys).toHaveLength(6)
    for (const key of keys) expect(sql).toContain(`'${key}',`)
  })

  it('scopes every subquery to the project', () => {
    const subqueries = sql.match(/from public\.release(s|_credits) \w+/g) ?? []
    expect(subqueries.length).toBeGreaterThan(0)
    expect((sql.match(/r\.project_id = p_project_id/g) ?? []).length).toBe(6)
  })

  it('is service-role only', () => {
    expect(sql).toMatch(/revoke all on function public\.release_stats_totals\(uuid\) from public, anon, authenticated;/)
    expect(sql).toMatch(/grant execute on function public\.release_stats_totals\(uuid\) to service_role;/)
  })
})
