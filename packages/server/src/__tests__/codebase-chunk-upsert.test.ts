/**
 * Chunk upserts that hit PostgREST's 8s statement timeout (57014).
 * The logged path is the file being indexed, not a test that touched the DB.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CODEBASE_CHUNK_UPSERT_BATCH,
  CODEBASE_CHUNK_UPSERT_MAX,
  dedupeChunkWrites,
  upsertCodebaseChunks,
  type CodebaseChunkWrite,
} from '../../supabase/functions/_shared/codebase-chunk-upsert.ts'

const P = '67a6453c-375d-41d7-833a-b33471159442'

function row(over: Partial<CodebaseChunkWrite> = {}): CodebaseChunkWrite {
  return {
    project_id: P,
    file_path: 'packages/server/src/__tests__/billing-rules.test.ts',
    symbol_name: null,
    signature: null,
    line_start: 1,
    line_end: 90,
    language: 'ts',
    content_hash: 'abc',
    content_preview: 'import { describe } from "vitest"',
    imports: [],
    last_modified: '2026-10-20T12:00:00.000Z',
    tombstoned_at: null,
    ...over,
  }
}

describe('dedupeChunkWrites', () => {
  it('keeps the last row for one file, including a null symbol name', () => {
    const first = row({ content_hash: 'old' })
    const second = row({ content_hash: 'new', embedding: [0.1, 0.2] })
    const other = row({ file_path: 'src/a.ts', symbol_name: 'foo', content_hash: 'keep' })
    expect(dedupeChunkWrites([first, other, second])).toEqual([second, other])
  })
})

describe('upsertCodebaseChunks', () => {
  it('does not call the database for an empty batch', async () => {
    let calls = 0
    const db = { rpc: async () => { calls++; return { data: 0, error: null } } }
    expect(await upsertCodebaseChunks(db as never, [])).toEqual({ error: null })
    expect(calls).toBe(0)
  })

  it('writes through upsert_codebase_chunks and keeps a refresh embedding absent', async () => {
    const calls: Array<{ fn: string; args: { p_rows: CodebaseChunkWrite[] } }> = []
    const db = {
      rpc: async (fn: string, args: { p_rows: CodebaseChunkWrite[] }) => {
        calls.push({ fn, args })
        return { data: args.p_rows.length, error: null }
      },
    }
    const refresh = row()
    const embedded = row({
      file_path: 'src/a.ts',
      symbol_name: 'foo',
      embedding: [0.25, 0.5],
      embedding_model: 'text-embedding-3-small',
    })
    expect(await upsertCodebaseChunks(db as never, [refresh, embedded])).toEqual({ error: null })
    expect(calls).toHaveLength(1)
    expect(calls[0].fn).toBe('upsert_codebase_chunks')
    expect(calls[0].args.p_rows[0].embedding).toBeUndefined()
    expect(calls[0].args.p_rows[1].embedding).toEqual([0.25, 0.5])
  })

  it('refuses a batch larger than the SQL cap before the round trip', async () => {
    let calls = 0
    const db = { rpc: async () => { calls++; return { data: null, error: null } } }
    const rows = Array.from({ length: CODEBASE_CHUNK_UPSERT_MAX + 1 }, (_, i) =>
      row({ file_path: `src/f${i}.ts`, symbol_name: `s${i}` }),
    )
    const result = await upsertCodebaseChunks(db as never, rows)
    expect(result.error?.code).toBe('22023')
    expect(calls).toBe(0)
  })

  it('returns the database error, including a statement timeout', async () => {
    const db = {
      rpc: async () => ({
        data: null,
        error: { code: '57014', message: 'canceling statement due to statement timeout' },
      }),
    }
    const result = await upsertCodebaseChunks(db as never, [row({ embedding: [0.1] })])
    expect(result.error).toEqual({
      code: '57014',
      message: 'canceling statement due to statement timeout',
    })
  })
})

describe('upsert_codebase_chunks migration', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20261020143000_upsert_codebase_chunks.sql'),
    'utf8',
  )

  it('gives the write 30s, keeps a null embedding, and is service-role only', () => {
    expect(sql).toMatch(/set statement_timeout = '30s'/)
    expect(sql).toMatch(/embedding = coalesce\(excluded\.embedding, existing\.embedding\)/)
    expect(sql).toMatch(/on conflict \(project_id, file_path, symbol_name\)/)
    expect(sql).toMatch(/jsonb_array_length\(p_rows\) > 25/)
    expect(sql).toMatch(/revoke all on function public\.upsert_codebase_chunks\(jsonb\) from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.upsert_codebase_chunks\(jsonb\) to service_role/)
    expect(CODEBASE_CHUNK_UPSERT_BATCH).toBeLessThanOrEqual(CODEBASE_CHUNK_UPSERT_MAX)
    expect(CODEBASE_CHUNK_UPSERT_BATCH).toBe(20)
  })

  it('the indexer no longer upserts chunks under the 8s role timeout', () => {
    const indexer = readFileSync(
      resolve(__dirname, '../../supabase/functions/webhooks-github-indexer/index.ts'),
      'utf8',
    )
    expect(indexer).toContain('upsertCodebaseChunks(')
    expect(indexer).toContain('CODEBASE_CHUNK_UPSERT_BATCH')
    expect(indexer).not.toMatch(/from\('project_codebase_files'\)\s*\.upsert\(/)
    expect(indexer).not.toMatch(/i \+= 200\)/)
  })
})
