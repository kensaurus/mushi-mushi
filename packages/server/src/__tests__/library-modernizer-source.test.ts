/**
 * library-modernizer files dependency proposals as reports. It left `source`
 * unset, so the column default 'widget' showed a dependency bot as a user's
 * widget report (glot.it, 2026-10-07). It now sets 'library_modernizer', which
 * an additive migration appends to reports_source_check (Helm copy identical).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SERVER = resolve(__dirname, '../../supabase')
const MIGRATION = '20261007140000_reports_source_library_modernizer.sql'

describe('library-modernizer report source', () => {
  it('sets source on the report insert and logs a refused insert', () => {
    const src = readFileSync(resolve(SERVER, 'functions/library-modernizer/index.ts'), 'utf8')
    const insert = src.slice(src.indexOf(".from('reports').insert({"))
    expect(insert.slice(0, 600)).toContain("source: 'library_modernizer'")
    expect(src).toContain("log.warn('modernization report insert failed'")
  })

  it('the migration appends the value without restating the list', () => {
    const sql = readFileSync(resolve(SERVER, 'migrations', MIGRATION), 'utf8')
    expect(sql).toContain("v_add  text[] := ARRAY['library_modernizer']")
    expect(sql).toContain('IF v_add <@ v_vals THEN')
    expect(sql).not.toMatch(/CHECK \(source IN \('api'/)
    expect(sql).not.toMatch(/\bupdate\s+public\.reports\b/i)
  })

  it('the Helm copy is identical', () => {
    const app = readFileSync(resolve(SERVER, 'migrations', MIGRATION), 'utf8')
    const helm = readFileSync(resolve(__dirname, '../../../../deploy/helm/migrations', MIGRATION), 'utf8')
    expect(helm).toBe(app)
  })
})
