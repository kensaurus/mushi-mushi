/**
 * mistake-clusterer is scheduled, and its first read works.
 *
 * Until 2026-10-07 no migration scheduled it (cron.job had no row), so 44
 * report embeddings had 0 cluster memberships. Its read also passed a query
 * builder to `.not('report_id', 'in', …)`, which supabase-js stringifies into
 * the filter `not.in.[object Object]`: a scheduled run would have 500'd.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const serverRoot = resolve(__dirname, '../..')
const migration = readFileSync(
  join(serverRoot, 'supabase/migrations/20261007142000_mistake_clusterer_cron.sql'),
  'utf-8',
)
const helmCopy = readFileSync(
  resolve(serverRoot, '../../deploy/helm/migrations/20261007142000_mistake_clusterer_cron.sql'),
  'utf-8',
)
const source = readFileSync(join(serverRoot, 'supabase/functions/mistake-clusterer/index.ts'), 'utf-8')

describe('mistake-clusterer schedule', () => {
  it('runs hourly through cron_http_post, so the 6-hourly coherence window fires once', () => {
    expect(migration).toMatch(
      /cron\.schedule\(\s*'mushi-mistake-clusterer-hourly',\s*'43 \* \* \* \*',\s*\$cmd\$select mushi\.cron_http_post\('mistake-clusterer', jsonb_build_object\('trigger', 'cron'\), 60000\);\$cmd\$/,
    )
    // The judge runs when the UTC hour is a multiple of 6; an hourly cron hits that once.
    expect(source).toMatch(/return h % 6 === 0/)
  })

  it('skips the schedule when pg_cron is absent', () => {
    expect(migration).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_namespace WHERE nspname = 'cron'\)/)
  })

  it('ships an identical Helm copy', () => {
    expect(helmCopy).toBe(migration)
  })
})

describe('mistake_clusterer_unclustered()', () => {
  it('reads embeddings with no membership row, one per report, oldest first, capped', () => {
    expect(migration).toMatch(/create or replace function public\.mistake_clusterer_unclustered\(p_limit integer default 200\)/)
    expect(migration).toMatch(/where not exists \(\s*select 1\s*from public\.report_cluster_membership m\s*where m\.report_id = re\.report_id\s*\)/)
    expect(migration).toMatch(/select distinct on \(re\.report_id\)/)
    expect(migration).toMatch(/limit greatest\(1, least\(coalesce\(p_limit, 200\), 1000\)\)/)
  })

  it('is callable by service_role only', () => {
    expect(migration).toMatch(/security invoker/)
    expect(migration).toMatch(
      /revoke all on function public\.mistake_clusterer_unclustered\(integer\) from public, anon, authenticated;/,
    )
    expect(migration).toMatch(/grant execute on function public\.mistake_clusterer_unclustered\(integer\) to service_role;/)
  })

  it('is what the function reads, instead of a query builder inside .not()', () => {
    expect(source).toMatch(/\.rpc\('mistake_clusterer_unclustered', \{ p_limit: MAX_REPORTS_PER_RUN \}\)/)
    expect(source).not.toMatch(/\.not\(\s*'report_id',\s*'in',\s*\n?\s*db\.from/)
  })
})
