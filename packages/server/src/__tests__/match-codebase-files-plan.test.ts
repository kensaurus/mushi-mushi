/**
 * match_codebase_files must keep a literal LIMIT on the IVFFlat scan.
 * A parameterized LIMIT inside PL/pgSQL becomes a generic plan and the
 * scan detoasts every embedding until statement_timeout (57014).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = '20261020150000_match_codebase_files_literal_limit.sql'
const migrationsDir = resolve(__dirname, '../../supabase/migrations')
const sql = readFileSync(resolve(migrationsDir, MIGRATION), 'utf8')

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('match_codebase_files literal limit', () => {
  it('is the latest definition of the function', () => {
    const definers = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) =>
        readFileSync(resolve(migrationsDir, name), 'utf8').includes(
          'create or replace function public.match_codebase_files(',
        ),
      )
      .sort()
    expect(definers.at(-1)).toBe(MIGRATION)
  })

  it('plans the unfiltered scan with a literal cap, not LIMIT match_count', () => {
    const ann = sliceBetween(sql, '-- ann: no path filter', '-- ann: broad path prefix')
    expect(ann).toContain('limit __CAP__')
    expect(ann).not.toMatch(/limit\s+match_count/i)
    expect(ann).not.toContain('file_path like')
    expect(ann).toContain('project_id::text = $2::text')
    expect(ann).toContain('order by pcf.embedding::halfvec(1536) <=> $1::halfvec(1536)')
    expect(ann).toContain('join project_codebase_files pcf on pcf.id = h.id')
    expect(ann).toMatch(/select\s+pcf\.id,\s+\(pcf\.embedding::halfvec\(1536\)/)
    expect(ann).toContain('order by h.distance + 0')
    expect(sql).toContain("least(greatest(coalesce(match_count, 5), 1), 20)")
    expect(sql).toContain("'__CAP__'")
    expect(sql).toContain('capped::text')
  })

  it('keeps the planner on the IVFFlat index', () => {
    expect(sql).toMatch(/set enable_seqscan to 'off'/)
    expect(sql).toMatch(/set enable_bitmapscan to 'off'/)
    expect(sql).toMatch(/set plan_cache_mode to 'force_custom_plan'/)
    expect(sql).toMatch(/set ivfflat\.probes to '20'/)
    expect(sql).toMatch(/set ivfflat\.max_probes to '60'/)
  })

  it('stops the prefix count once it passes the 2000-row threshold', () => {
    const count = sliceBetween(sql, 'select count(*) into prefix_rows', 'end if;')
    expect(count).toMatch(/from \(\s*select 1\s+from project_codebase_files pcf/)
    expect(count).toMatch(/limit 2001\s*\) bounded;/)
    expect(sql).toContain('prefix_rows <= 2000')
  })

  it('documents the 20-row ceiling on the function', () => {
    expect(sql).toMatch(
      /comment on function public\.match_codebase_files\(extensions\.vector, uuid, integer, text\) is\s+'[^']*clamped to 1\.\.20[^']*'/,
    )
  })

  it('no caller asks for more rows than the 20-row cap', () => {
    const fns = resolve(__dirname, '../../supabase/functions')
    const read = (p: string) => readFileSync(resolve(fns, p), 'utf8')

    expect(read('_shared/rag.ts')).toMatch(
      /rpc\('match_codebase_files', \{[^}]*match_count: 5,/,
    )

    const understand = read('_shared/codebase-understand.ts')
    expect(understand).toMatch(/rpc\('match_codebase_files', \{[^}]*match_count: k,/)
    const askCalls = [...read('api/routes/codebase-understand.ts').matchAll(
      /retrieveCodeForQuestion\([^)]*?,\s*(\d+)\)/g,
    )]
    expect(askCalls.length).toBeGreaterThan(0)
    for (const call of askCalls) expect(Number(call[1])).toBeLessThanOrEqual(20)

    const search = read('api/routes/project-codebase.ts')
    expect(search).toMatch(/rpc\('match_codebase_files', \{[^}]*match_count: k,/)
    expect(search).toContain('const k = Math.min(20, Math.max(1, Number(body.k ?? 8)))')

    const callers = readdirSync(fns, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => read(name).includes("rpc('match_codebase_files'"))
      .sort()
    expect(callers).toEqual([
      '_shared/codebase-understand.ts',
      '_shared/rag.ts',
      'api/routes/project-codebase.ts',
    ])
  })

  it('documents the pgvector load and matches the embedding dimension', () => {
    expect(sql).toMatch(
      /-- Load pgvector so the ivfflat\.\* settings[^\n]*\n(--[^\n]*\n)*select extensions\.vector_dims/,
    )
    const embeddings = readFileSync(
      resolve(__dirname, '../../supabase/functions/_shared/embeddings.ts'),
      'utf8',
    )
    expect(embeddings).toContain('const DEFAULT_DIMENSIONS = 1536')
    const dims = new Set([...sql.matchAll(/halfvec\((\d+)\)/g)].map((m) => m[1]))
    expect([...dims]).toEqual(['1536'])
  })

  it('the Helm copy is identical', () => {
    const helm = readFileSync(
      resolve(__dirname, '../../../../deploy/helm/migrations', MIGRATION),
      'utf8',
    )
    expect(helm).toBe(sql)
  })
})
