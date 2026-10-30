/**
 * Runs match_report_embeddings from 20261030190000 against pgvector.
 * A project at or under 2000 embeddings stays an exact sort. Above that,
 * and only on pgvector 0.8+, the partial HNSW index is scanned, then the
 * planner settings the scan changed are put back. A short HNSW list raises
 * match_report_embeddings_hnsw_short.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { auto_explain } from '@electric-sql/pglite/contrib/auto_explain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261030190000_match_report_embeddings_project_scan.sql'),
  'utf8',
)

const SMALL = '10000000-0000-4000-8000-000000000001'
const BOUNDARY = '10000000-0000-4000-8000-000000000002'
const LARGE = '10000000-0000-4000-8000-000000000003'
const SMALL_NEAR = '20000000-0000-4000-8000-000000000001'
const SMALL_FAR = '20000000-0000-4000-8000-000000000002'
const BOUNDARY_NEAR = '20000000-0000-4000-8000-000000000011'
const LARGE_NEAR = '20000000-0000-4000-8000-000000000021'
const QUERY = '[1,0,0,0]'

const logs: string[] = []
let db: PGlite
let vectorVersion = ''
let keptInvoker = false
let ownerBefore = ''
let ownerAfter = ''
let grantKept = false

interface MatchRow {
  report_id: string
  similarity: number
  description: string
}

async function match(projectId: string, threshold: number, count: number) {
  logs.length = 0
  const notices: string[] = []
  const started = performance.now()
  const result = await db.query<MatchRow>(
    `select report_id, similarity, description
     from public.match_report_embeddings($1::vector, $2::float8, $3::int, $4::uuid)`,
    [QUERY, threshold, count, projectId],
    {
      onNotice: (notice) => {
        if (notice.message) notices.push(notice.message)
      },
    },
  )
  return { rows: result.rows, notices, ms: performance.now() - started, log: logs.join('\n') }
}

describe('match_report_embeddings on pgvector', () => {
  beforeAll(async () => {
    db = new PGlite({
      extensions: { vector, auto_explain },
      onStderr: (text) => {
        logs.push(text)
        return false
      },
    })
    await db.waitReady
    const step = async (name: string, sql: string) => {
      try {
        await db.exec(sql)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${name}: ${message}`)
      }
    }
    await step('schema', `
      create schema if not exists extensions;
      create extension if not exists vector with schema extensions;
      set search_path to public, extensions;
      create table public.reports (
        id uuid primary key,
        project_id uuid not null,
        description text,
        category text,
        created_at timestamptz not null default now(),
        report_group_id uuid
      );
      create table public.report_embeddings (
        id uuid primary key default gen_random_uuid(),
        report_id uuid not null references public.reports(id),
        model text not null,
        embedding vector(4)
      );
      create index idx_embeddings_default
        on public.report_embeddings using hnsw (embedding vector_cosine_ops)
        with (m = 16, ef_construction = 64)
        where model = 'text-embedding-3-small';
    `)
    await step('create-function', MIGRATION)

    const ident = await db.query<{ prosecdef: boolean; owner: string }>(`
      select p.prosecdef,
             p.proowner::text as owner
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'match_report_embeddings'
    `)
    ownerBefore = ident.rows[0].owner
    keptInvoker = ident.rows[0].prosecdef === false
    const signature = 'extensions.vector, double precision, integer, uuid'
    await step('role', `create role mushi_embedding_reader nologin`)
    await step(
      'grant',
      `grant execute on function public.match_report_embeddings(${signature}) to mushi_embedding_reader`,
    )
    await step('replace', MIGRATION)
    const after = await db.query<{ prosecdef: boolean; owner: string; granted: boolean }>(`
      select p.prosecdef,
             p.proowner::text as owner,
             has_function_privilege(
               'mushi_embedding_reader',
               'public.match_report_embeddings(${signature})',
               'execute'
             ) as granted
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'match_report_embeddings'
    `)
    ownerAfter = after.rows[0].owner
    keptInvoker = keptInvoker && after.rows[0].prosecdef === false
    grantKept = after.rows[0].granted === true

    const version = await db.query<{ extversion: string }>(
      `select extversion from pg_extension where extname = 'vector'`,
    )
    vectorVersion = version.rows[0].extversion

    await step('seed', `
      select setseed(0.42);
      insert into public.reports (id, project_id, description, category) values
        ('${SMALL_NEAR}', '${SMALL}', 'near', 'bug'),
        ('${SMALL_FAR}', '${SMALL}', 'far', 'bug'),
        ('${BOUNDARY_NEAR}', '${BOUNDARY}', 'near', 'bug'),
        ('${LARGE_NEAR}', '${LARGE}', 'near', 'bug');
      insert into public.reports (id, project_id, description, category)
      select gen_random_uuid(), '${BOUNDARY}', 'noise', 'bug' from generate_series(1, 1999);
      insert into public.reports (id, project_id, description, category)
      select gen_random_uuid(), '${LARGE}', 'noise', 'bug' from generate_series(1, 2000);
      insert into public.report_embeddings (report_id, model, embedding)
      select r.id, 'text-embedding-3-small',
             case
               when r.description = 'near' then '[1,0,0,0]'::vector
               when r.id = '${SMALL_FAR}' then '[0,1,0,0]'::vector
               else array[random(), random(), random(), random()]::vector(4)
             end
      from public.reports r;
      load 'auto_explain';
      set auto_explain.log_min_duration = 0;
      set auto_explain.log_nested_statements = on;
      set auto_explain.log_analyze = on;
      set log_min_messages = log;
    `)
  }, 60_000)

  afterAll(async () => {
    await db?.close()
  })

  it('stays security invoker and keeps the owner and execute grant', () => {
    expect(keptInvoker).toBe(true)
    expect(ownerAfter).toBe(ownerBefore)
    expect(grantKept).toBe(true)
  })

  it('returns the nearest rows for a project at or under 2000 without the HNSW scan', async () => {
    const [major, minor] = vectorVersion.split('.').map(Number)
    expect(major > 0 || minor >= 8).toBe(true)

    const small = await match(SMALL, -0.1, 2)
    expect(small.rows.map((row) => row.description)).toEqual(['near', 'far'])
    expect(small.rows[0].report_id).toBe(SMALL_NEAR)
    expect(Number(small.rows[0].similarity)).toBeCloseTo(1, 5)
    expect(small.log).not.toContain('idx_embeddings_default')
    expect(small.log).not.toContain("set_config('hnsw.iterative_scan', 'relaxed_order'")
    expect(small.notices.join('\n')).not.toContain('match_report_embeddings_hnsw_short')

    const boundary = await match(BOUNDARY, 0.5, 3)
    expect(boundary.rows[0].report_id).toBe(BOUNDARY_NEAR)
    expect(Number(boundary.rows[0].similarity)).toBeCloseTo(1, 5)
    expect(boundary.log).not.toContain('idx_embeddings_default')
    expect(boundary.log).not.toContain("set_config('hnsw.iterative_scan', 'relaxed_order'")
  })

  it('uses the partial HNSW index above 2000 and restores planner settings', async () => {
    const large = await match(LARGE, 0.5, 2)
    expect(large.ms).toBeLessThan(5_000)
    expect(large.rows[0].report_id).toBe(LARGE_NEAR)
    expect(Number(large.rows[0].similarity)).toBeCloseTo(1, 5)
    expect(large.rows).toHaveLength(2)
    expect(large.log).toContain('Index Scan using idx_embeddings_default')
    expect(large.log).toContain("set_config('hnsw.iterative_scan', 'relaxed_order'")
    expect(large.notices.join('\n')).not.toContain('match_report_embeddings_hnsw_short')

    const restored = await db.transaction(async (tx) => {
      await tx.exec(`
        select set_config('enable_seqscan', 'off', true);
        select set_config('hnsw.iterative_scan', 'strict_order', true);
        select set_config('hnsw.ef_search', '17', true);
      `)
      await tx.query(
        `select 1 from public.match_report_embeddings($1::vector, 0.5::float8, 2, $2::uuid)`,
        [QUERY, LARGE],
      )
      return tx.query<{ seq: string; it: string; ef: string }>(`
        select current_setting('enable_seqscan') as seq,
               current_setting('hnsw.iterative_scan') as it,
               current_setting('hnsw.ef_search') as ef
      `)
    })
    expect(restored.rows[0].seq).toBe('off')
    expect(restored.rows[0].it).toBe('strict_order')
    expect(restored.rows[0].ef).toBe('17')

    const defaults = await db.transaction(async (tx) => {
      await tx.query(
        `select 1 from public.match_report_embeddings($1::vector, 0.5::float8, 2, $2::uuid)`,
        [QUERY, LARGE],
      )
      return tx.query<{ seq: string; it: string }>(`
        select current_setting('enable_seqscan') as seq,
               current_setting('hnsw.iterative_scan') as it
      `)
    })
    expect(defaults.rows[0].seq).toBe('on')
    expect(defaults.rows[0].it).toBe('off')
  })

  it('warns when the HNSW branch returns fewer rows than match_count', async () => {
    const short = await match(LARGE, 0.999999, 5)
    expect(short.rows.length).toBeGreaterThan(0)
    expect(short.rows.length).toBeLessThan(5)
    expect(short.rows[0].report_id).toBe(LARGE_NEAR)
    const notice = short.notices.find((line) => line.includes('match_report_embeddings_hnsw_short'))
    expect(notice).toMatch(
      new RegExp(`project_id=${LARGE} returned=${short.rows.length} match_count=5`),
    )
  })

  it('keeps the exact scan when pgvector is older than 0.8', async () => {
    try {
      await db.exec(`update pg_extension set extversion = '0.7.4' where extname = 'vector'`)
      const exact = await match(LARGE, 0.5, 2)
      expect(exact.rows[0].report_id).toBe(LARGE_NEAR)
      expect(Number(exact.rows[0].similarity)).toBeCloseTo(1, 5)
      expect(exact.log).not.toContain('idx_embeddings_default')
      expect(exact.log).not.toContain("set_config('hnsw.iterative_scan', 'relaxed_order'")
      expect(exact.notices.join('\n')).not.toContain('match_report_embeddings_hnsw_short')
    } finally {
      await db.exec(`update pg_extension set extversion = '${vectorVersion}' where extname = 'vector'`)
    }
  })
})
