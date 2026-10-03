/**
 * FILE: packages/server/src/__tests__/portfolio-repeated-findings-view.test.ts
 * PURPOSE: Pin the newest definition of public.portfolio_repeated_findings to
 *          design_drift runs of phase 'scan' only.
 *
 * Why (2026-10-03): CI pushes write their own design_drift phases
 * (ci_branch_scan for a PR, ci_untrusted_scan for a public key, ci_scan for a
 * legacy CLI). The first view left out only 'refresh', so a PR run became the
 * project's "latest" design run and its findings showed up as org-wide
 * repeated findings, which every other reader refuses.
 *
 * There is no Postgres in this suite; this reads the SQL verbatim, the same
 * way the other *-contract tests read migrations.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(__dirname, '../../supabase/migrations')
const VIEW = 'create or replace view public.portfolio_repeated_findings'

function latestDefinition(): { file: string; sql: string } {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  const defining = files.filter((f) => readFileSync(resolve(migrationsDir, f), 'utf8').includes(VIEW))
  const file = defining[defining.length - 1]
  const sql = readFileSync(resolve(migrationsDir, file), 'utf8')
  const start = sql.indexOf(VIEW)
  return { file, sql: sql.slice(start, sql.indexOf(';', start)) }
}

describe('portfolio_repeated_findings', () => {
  it('reads only phase scan design_drift runs (no PR, untrusted, legacy CI or refresh runs)', () => {
    const { file, sql } = latestDefinition()
    expect(file >= '20261003110100').toBe(true)
    expect(sql).toContain("not (r.gate = 'design_drift' and coalesce(r.summary->>'phase', '') <> 'scan')")
    expect(sql).not.toContain("= 'refresh'")
  })

  it('keeps security_invoker and the same columns', () => {
    const { sql } = latestDefinition()
    expect(sql).toContain('with (security_invoker = true)')
    for (const col of ['p.organization_id', 'f.rule_id', 'l.gate', 'as finding_count', 'as project_count', 'as project_ids', 'as max_severity_rank']) {
      expect(sql).toContain(col)
    }
  })

  it('keeps anon out and authenticated in', () => {
    const { file } = latestDefinition()
    const all = readFileSync(resolve(migrationsDir, file), 'utf8')
    expect(all).toContain('revoke all on public.portfolio_repeated_findings from anon;')
    expect(all).toContain('grant select on public.portfolio_repeated_findings to authenticated;')
  })
})
