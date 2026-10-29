/**
 * Similarity search (match_report_embeddings) exact-scanned a project's
 * embeddings and was canceled at the 8s statement timeout. The migration
 * keeps the HNSW plan: project_id on the embedding row, iterative scan,
 * no btree on that column.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = '20261029170000_match_report_embeddings_iterative_scan.sql'
const serverRoot = resolve(__dirname, '../..')

function sql(): string {
  return readFileSync(resolve(serverRoot, 'supabase/migrations', MIGRATION), 'utf8')
}

describe('match_report_embeddings iterative scan', () => {
  it('filters on the embedding row and forces the HNSW scan', () => {
    const text = sql()
    const fn = text.slice(text.indexOf('function public.match_report_embeddings'))
    expect(fn).toContain("set hnsw.iterative_scan to 'strict_order'")
    expect(fn).toContain("set enable_seqscan to 'off'")
    expect(fn).toContain('re.project_id::text = p_project_id::text')
    expect(fn).toContain('(re.embedding <=> query_embedding) < (1 - match_threshold)')
    expect(fn).not.toContain('1 - (re.embedding <=> query_embedding) > match_threshold')
    expect(fn).toContain('with hits as materialized')
  })

  it('backfills project_id without maintaining the graph row by row, and does not btree it', () => {
    const text = sql()
    const dropAt = text.indexOf('drop index if exists public.idx_embeddings_default')
    const updateAt = text.indexOf('update public.report_embeddings re')
    const createAt = text.lastIndexOf('create index idx_embeddings_default')
    expect(dropAt).toBeGreaterThan(-1)
    expect(dropAt).toBeLessThan(updateAt)
    expect(updateAt).toBeLessThan(createAt)
    expect(text).toContain('add column if not exists project_id uuid')
    expect(text).toContain('report_embeddings_set_project_id')
    expect(text).not.toMatch(/report_embeddings[^;\n]*using btree/i)
    expect(text).not.toMatch(/on public\.report_embeddings \(project_id\)/i)
  })

  it('the Helm copy is identical', () => {
    const app = sql()
    const helm = readFileSync(resolve(serverRoot, '../../deploy/helm/migrations', MIGRATION), 'utf8')
    expect(helm).toBe(app)
  })
})
