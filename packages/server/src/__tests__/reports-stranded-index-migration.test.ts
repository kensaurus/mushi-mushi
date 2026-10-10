/**
 * recover_stranded_pipeline() probes reports globally by status and age.
 * 20260520600000 replaced its partial (status, created_at) index with a
 * project_id-leading one; 20261010180300 restores a partial index whose
 * predicate matches the cron's WHERE clause.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261010180300_reports_stranded_scan_index.sql'),
  'utf8',
).replace(/--[^\n]*/g, '')

describe('20261010180300_reports_stranded_scan_index', () => {
  it('indexes created_at for new/queued reports without a project_id prefix', () => {
    expect(sql).toMatch(
      /create index if not exists reports_stranded_created_at_idx\s+on public\.reports \(created_at\)\s+where status in \('new', 'queued'\);/,
    )
  })
})
