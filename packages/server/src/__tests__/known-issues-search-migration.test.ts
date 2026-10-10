/**
 * "Others who hit this" sends a report's scrubbed error message to Firecrawl
 * (_shared/known-issues.ts). 20261010190000 makes that a per-project opt-in:
 * the column must default to off for every existing and new project, and the
 * code must read the same column name.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261010190000_project_settings_known_issues_search.sql'),
  'utf8',
)
const lookup = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/known-issues.ts'), 'utf8')

describe('20261010190000_project_settings_known_issues_search', () => {
  it('adds the opt-in as a non-null boolean that defaults to off', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.project_settings\s+ADD COLUMN IF NOT EXISTS known_issues_search_enabled boolean NOT NULL DEFAULT false;/,
    )
    expect(sql).not.toMatch(/DEFAULT true/i)
  })

  it('backfills nothing to on', () => {
    expect(sql).not.toMatch(/\bUPDATE\b/i)
  })

  it('is the column the lookup reads', () => {
    expect(lookup).toContain(".select('known_issues_search_enabled')")
  })
})
