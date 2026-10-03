/**
 * FILE: sibling-dispatch.test.ts
 * PURPOSE: The row fix-worker inserts for a cross-repo sibling job must pass
 *          fix_dispatch_jobs' CHECK constraints. It used `skill: 'fix'`,
 *          which the skill CHECK rejects, so no sibling job was ever created
 *          and the failure was logged as non-fatal.
 *
 * The allowed values are read from the migrations, not restated here, so a
 * constraint change and the builder cannot drift apart unseen.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { siblingDispatchRow } from '../../supabase/functions/_shared/sibling-dispatch.ts'

const MIGRATIONS = resolve(__dirname, '../../supabase/migrations')

/** Allowed values of `<column> ... CHECK (<column> IN (...))` in the newest migration that defines it. */
function allowedValues(column: string, constraintHint: RegExp): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  let found: string[] | null = null
  for (const f of files) {
    const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8')
    if (!constraintHint.test(sql)) continue
    const re = new RegExp(`CHECK\\s*\\(\\s*\\(?\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(sql)) !== null) {
      found = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    }
  }
  if (!found) throw new Error(`no CHECK for ${column} found in migrations`)
  return found
}

describe('sibling dispatch row', () => {
  const row = siblingDispatchRow({
    projectId: 'p1',
    reportId: 'r1',
    coordinationId: 'c1',
    sibling: { id: 'repo-2', repo_url: 'https://github.com/o/backend' },
    prUrl: 'https://github.com/o/frontend/pull/7',
    siblingCount: 1,
  })

  it('uses a skill the fix_dispatch_jobs CHECK allows', () => {
    const skills = allowedValues('skill', /fix_dispatch_jobs/)
    expect(skills).toContain('dispatch_fix')
    expect(skills).toContain(row.skill)
  })

  it('uses a status the fix_dispatch_jobs CHECK allows', () => {
    const statuses = allowedValues('status', /fix_dispatch_jobs_status_check/)
    expect(statuses).toContain(row.status)
  })

  it('is an automatic dispatch (capped) that names its target repo', () => {
    expect(row.dispatch_metadata).toMatchObject({
      trigger: 'automatic',
      target_repo_id: 'repo-2',
      coordinated_with_pr: 'https://github.com/o/frontend/pull/7',
    })
  })
})
