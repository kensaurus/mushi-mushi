/**
 * Graph upsert used to die with SQLSTATE 57014 (Sentry 7786063319).
 * Pins: dead file nodes are not written back, a live sibling is requeued,
 * a busy advisory lock is requeued, and a statement timeout is tried once.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type Row } from './__stubs__/fake-supabase.ts'
import { listIndexedFilePaths, listIndexedFileRows, pruneGraphToLivePaths, writeCodebaseGraph } from '../../supabase/functions/_shared/codebase-graph-write.ts'
import { buildGraphFromIndex, fingerprintFile } from '../../supabase/functions/_shared/codebase-graph-build.ts'
import type { IndexedFileRow, KnowledgeGraph } from '../../supabase/functions/_shared/codebase-graph-build.ts'
vi.mock('../../supabase/functions/_shared/wiki-ingest.ts', () => ({
  runWikiIngestForProject: vi.fn(async () => ({ processed: 0, ready: 0, failed: 0 })),
}))

;(globalThis as { Deno?: unknown }).Deno ??= { env: { get: (k: string) => process.env[k] } }
const runner = await import('../../supabase/functions/_shared/codebase-analyze-runner.ts')

const P = '542b34e0-019e-41fe-b900-7b637717bb86'

function graph(nodes: KnowledgeGraph['nodes'], edges: KnowledgeGraph['edges'] = []): KnowledgeGraph {
  return {
    version: '1.0.0',
    kind: 'codebase',
    project: { name: 'glot.it', languages: [], frameworks: [], analyzedAt: '2026-10-07T00:00:00Z' },
    nodes,
    edges,
    layers: [{ id: 'lib', name: 'Lib', nodeIds: nodes.map((n) => n.id) }],
  }
}

function fileRow(path: string): Row {
  return {
    id: path,
    project_id: P,
    file_path: path,
    symbol_name: null,
    language: 'typescript',
    tombstoned_at: null,
    indexed_at: '2026-10-07T00:00:00Z',
    imports: [],
  }
}

describe('pruneGraphToLivePaths', () => {
  it('drops nodes whose file has left the index and the edges that used them', () => {
    const pruned = pruneGraphToLivePaths(
      graph(
        [
          { id: 'a', type: 'file', name: 'a.ts', filePath: 'src/a.ts' },
          { id: 'b', type: 'file', name: 'b.ts', filePath: 'src/b.ts' },
        ],
        [{ source: 'a', target: 'b', type: 'imports', direction: 'directed' }],
      ),
      new Set(['src/a.ts']),
    )
    expect(pruned.nodes.map((n) => n.filePath)).toEqual(['src/a.ts'])
    expect(pruned.edges).toEqual([])
    expect(pruned.layers[0]?.nodeIds).toEqual(['a'])
  })

  it('keeps a non-empty graph when the path lookup came back empty', () => {
    const original = graph([{ id: 'a', type: 'file', name: 'a.ts', filePath: 'src/a.ts' }])
    expect(pruneGraphToLivePaths(original, new Set())).toBe(original)
  })
})

describe('listIndexedFilePaths', () => {
  it('pages by file_path after the last one, never by offset (MUSHI-MUSHI-SERVER-2Q)', async () => {
    const rows: Row[] = []
    // 2,600 chunk rows over 1,300 paths: pages end inside a path's chunks.
    for (let i = 0; i < 1300; i++) {
      const path = `src/f${String(i).padStart(4, '0')}.ts`
      rows.push({ ...fileRow(path), id: `${path}#1` }, { ...fileRow(path), id: `${path}#2`, symbol_name: 'x' })
    }
    rows.push({ ...fileRow('src/gone.ts'), tombstoned_at: '2026-10-07T00:00:00Z' })
    rows.push({ ...fileRow('src/other.ts'), project_id: 'another-project' })
    const db = makeFakeDb({ project_codebase_files: rows })
    const paths = await listIndexedFilePaths(db as never, P)
    expect(paths.size).toBe(1300)
    expect(paths.has('src/f0000.ts') && paths.has('src/f1299.ts')).toBe(true)
    expect(paths.has('src/gone.ts') || paths.has('src/other.ts')).toBe(false)
  })

  it('reads with a file_path keyset in the source', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/codebase-graph-write.ts'), 'utf8')
    expect(src).toMatch(/\.gt\('file_path', after\)/)
    expect(src).not.toMatch(/\.range\(/)
  })
})

describe('listIndexedFileRows', () => {
  it('reads past PostgREST max_rows instead of stopping at 1,000 rows', async () => {
    const rows: Row[] = []
    for (let i = 0; i < 2500; i++) {
      const path = `src/f${String(i).padStart(4, '0')}.ts`
      rows.push({ ...fileRow(path), content_preview: '' })
    }
    const db = makeFakeDb({ project_codebase_files: rows }, { maxRows: 1000 })
    const index = await listIndexedFileRows(db as never, P)
    expect(index.complete).toBe(true)
    expect(index.rows).toHaveLength(2500)
    expect(new Set(index.rows.map((r) => r.file_path)).size).toBe(2500)
  })

  it('keeps every chunk row of a path that straddles a page, without duplicates', async () => {
    const rows: Row[] = []
    // 3 rows a path, so a 1,000-row page ends inside a path's chunks (an even
    // count put every boundary between paths and never tested the straddle).
    for (let i = 0; i < 1300; i++) {
      const path = `src/f${String(i).padStart(4, '0')}.ts`
      for (let c = 1; c <= 3; c++) {
        rows.push({ ...fileRow(path), id: `${path}-${c}`, symbol_name: c === 1 ? null : `x${c}` })
      }
    }
    rows.push({ ...fileRow('src/gone.ts'), tombstoned_at: '2026-10-07T00:00:00Z' })
    const db = makeFakeDb({ project_codebase_files: rows }, { maxRows: 1000 })
    const index = await listIndexedFileRows(db as never, P)
    expect(index.complete).toBe(true)
    expect(index.rows).toHaveLength(3900)
    expect(new Set(index.rows.map((r) => r.id)).size).toBe(3900)
    expect(index.rows.some((r) => r.file_path === 'src/gone.ts')).toBe(false)
  })

  it('keeps only a symbol-less row\'s content_preview, so 50k rows fit in the worker', async () => {
    const preview = 'x'.repeat(600)
    const rows: Row[] = []
    for (let i = 0; i < 300; i++) {
      const path = `src/f${String(i).padStart(4, '0')}.ts`
      rows.push({ ...fileRow(path), id: `${path}-file`, content_preview: preview })
      for (let c = 1; c <= 5; c++) {
        rows.push({ ...fileRow(path), id: `${path}-s${c}`, symbol_name: `s${c}`, content_preview: preview })
      }
    }
    const db = makeFakeDb({ project_codebase_files: rows }, { maxRows: 1000 })
    const index = await listIndexedFileRows(db as never, P)
    expect(index.rows).toHaveLength(1800)
    const withPreview = index.rows.filter((r) => r.content_preview)
    expect(withPreview).toHaveLength(300)
    expect(withPreview.every((r) => !r.symbol_name)).toBe(true)
    // The graph is the same one the untrimmed rows produced: nothing reads a
    // symbol row's preview.
    const trimmed = buildGraphFromIndex({
      projectName: 'glot.it',
      fileRows: index.rows.filter((r) => !r.symbol_name),
      symbolRows: index.rows.filter((r) => r.symbol_name),
    })
    const untrimmed = buildGraphFromIndex({
      projectName: 'glot.it',
      fileRows: rows.filter((r) => !r.symbol_name) as unknown as IndexedFileRow[],
      symbolRows: rows.filter((r) => r.symbol_name) as unknown as IndexedFileRow[],
    })
    expect(trimmed.nodes).toEqual(untrimmed.nodes)
    expect(trimmed.edges).toEqual(untrimmed.edges)
  })

  it('pages inside one path whose rows fill a whole page instead of skipping the rest', async () => {
    const rows: Row[] = []
    // One god file with more chunk rows than a page: the walk used to step
    // past it with `gt` and drop rows 1,001+ while still reporting complete.
    for (let c = 1; c <= 2300; c++) {
      rows.push({ ...fileRow('src/big.ts'), id: `src/big.ts-${String(c).padStart(5, '0')}`, symbol_name: `s${c}` })
    }
    rows.push({ ...fileRow('src/zz.ts'), id: 'src/zz.ts-1' })
    const db = makeFakeDb({ project_codebase_files: rows }, { maxRows: 1000 })
    const index = await listIndexedFileRows(db as never, P)
    expect(index.complete).toBe(true)
    expect(index.rows.filter((r) => r.file_path === 'src/big.ts')).toHaveLength(2300)
    expect(index.rows.some((r) => r.file_path === 'src/zz.ts')).toBe(true)
    expect(new Set(index.rows.map((r) => r.id)).size).toBe(2301)
  })
})

describe('writeCodebaseGraph', () => {
  const args = {
    projectId: P,
    indexFingerprint: '1:2026-10-07T00:00:00Z',
    commitSha: 'abc',
    graph: graph([{ id: 'a', type: 'file', name: 'a.ts', filePath: 'src/a.ts' }]),
  }

  it('retries a statement timeout once', async () => {
    let calls = 0
    const db = {
      rpc: async () => {
        calls++
        if (calls === 1) {
          return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
        }
        return { data: null, error: null }
      },
    }
    expect(await writeCodebaseGraph(db as never, args)).toEqual({ ok: true })
    expect(calls).toBe(2)
  })

  it('does not retry when the project lock is busy', async () => {
    let calls = 0
    const db = {
      rpc: async () => {
        calls++
        return { data: null, error: { code: '55P03', message: 'graph_write_busy' } }
      },
    }
    expect(await writeCodebaseGraph(db as never, args)).toMatchObject({ ok: false, busy: true })
    expect(calls).toBe(1)
  })
})

describe('runCodebaseAnalyzeJob graph write', () => {
  function pushJob(id: string, extra: Row = {}): Row {
    return {
      id,
      project_id: P,
      status: 'queued',
      trigger: 'push',
      changed_paths: ['src/a.ts'],
      created_at: '2026-10-07T00:00:00Z',
      ...extra,
    }
  }

  function dbWith(extra: Record<string, Row[]> = {}) {
    return makeFakeDb({
      codebase_analyze_jobs: [pushJob('job-1')],
      projects: [{ id: P, name: 'glot.it' }],
      project_repos: [{ project_id: P, is_primary: true, commit_sha: 'abc123' }],
      project_codebase_files: [fileRow('src/a.ts')],
      project_codebase_graph: [],
      ...extra,
    })
  }

  it('does not write nodes for files that are no longer indexed', async () => {
    const db = dbWith({
      project_codebase_graph: [{
        project_id: P,
        index_fingerprint: 'stale',
        graph: graph(
          [
            { id: 'src/a.ts', type: 'file', name: 'a.ts', filePath: 'src/a.ts' },
            { id: 'gone', type: 'file', name: 'b.ts', filePath: 'src/b.ts' },
          ],
          [{ source: 'src/a.ts', target: 'gone', type: 'imports', direction: 'directed' }],
        ),
      }],
    })
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'completed' })
    const write = db.rpcCalls.find((c) => c.fn === 'write_codebase_graph')
    const nodes = (write?.args.p_graph as KnowledgeGraph).nodes
    expect(nodes.some((n) => n.filePath === 'src/b.ts')).toBe(false)
    expect(nodes.some((n) => n.filePath === 'src/a.ts')).toBe(true)
  })

  it('skips the upsert when the stored fingerprint still matches the index', async () => {
    const db = dbWith({
      project_codebase_graph: [{ project_id: P, index_fingerprint: '1:2026-10-07T00:00:00Z', graph: graph([]) }],
    })
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'completed', pathsAnalyzed: 0 })
    expect(db.rpcCalls.filter((c) => c.fn === 'write_codebase_graph')).toHaveLength(0)
    expect(db.tables.codebase_analyze_jobs[0]).toMatchObject({ status: 'completed', plan: { unchanged: true } })
  })

  it('writes every indexed file, not the first max_rows page', async () => {
    const files: Row[] = []
    for (let i = 0; i < 1200; i++) files.push({ ...fileRow(`src/f${String(i).padStart(4, '0')}.ts`), content_preview: '' })
    const db = makeFakeDb({
      codebase_analyze_jobs: [pushJob('job-1', { changed_paths: null })],
      projects: [{ id: P, name: 'glot.it' }],
      project_repos: [{ project_id: P, is_primary: true, commit_sha: 'abc123' }],
      project_codebase_files: files,
      project_codebase_graph: [],
    }, { maxRows: 1000 })
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'completed' })
    const write = db.rpcCalls.find((c) => c.fn === 'write_codebase_graph')
    expect((write?.args.p_graph as KnowledgeGraph).nodes).toHaveLength(1200)
  })

  it('does not merge the stored document back into a whole-index rebuild', async () => {
    const db = dbWith({
      codebase_analyze_jobs: [pushJob('job-1', { changed_paths: null })],
      project_codebase_graph: [{
        project_id: P,
        index_fingerprint: 'stale',
        // No filePath, so neither the merge nor the prune can drop it.
        graph: graph([{ id: 'ghost', type: 'module', name: 'ghost' }]),
      }],
    })
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'completed' })
    const write = db.rpcCalls.find((c) => c.fn === 'write_codebase_graph')
    expect((write?.args.p_graph as KnowledgeGraph).nodes.some((n) => n.id === 'ghost')).toBe(false)
  })

  it('logs a fingerprint batch that failed instead of dropping the error', async () => {
    const files: Row[] = []
    for (let i = 0; i < 600; i++) {
      files.push({ ...fileRow(`src/f${String(i).padStart(4, '0')}.ts`), content_preview: '' })
    }
    const db = makeFakeDb({
      codebase_analyze_jobs: [pushJob('job-1', { changed_paths: null })],
      projects: [{ id: P, name: 'glot.it' }],
      project_repos: [{ project_id: P, is_primary: true, commit_sha: 'abc123' }],
      project_codebase_files: files,
      project_codebase_graph: [],
    }, { maxRows: 1000 })
    const realFrom = db.from.bind(db)
    const batches: number[] = []
    db.from = ((table: string) => {
      if (table !== 'project_codebase_fingerprints') return realFrom(table)
      return {
        select: (cols?: string) => realFrom(table).select(cols),
        upsert: async (payload: Row[]) => {
          batches.push(payload.length)
          return batches.length === 2
            ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
            : { data: null, error: null }
        },
      }
    }) as typeof db.from
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
      expect(result).toMatchObject({ ok: true, status: 'completed' })
      expect(batches).toEqual([500, 100])
      const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(logged).toContain('project_codebase_fingerprints batch upsert failed')
      expect(logged).toContain('batchStart')
    } finally {
      warn.mockRestore()
    }
  })

  it('fingerprints only the paths a push names', async () => {
    const db = dbWith({
      project_codebase_files: [fileRow('src/a.ts'), fileRow('src/b.ts'), fileRow('src/c.ts')],
    })
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'completed' })
    // changed_paths is ['src/a.ts']: the other two files' index rows did not
    // move, so re-upserting their fingerprints is a round trip for nothing.
    expect(db.tables.project_codebase_fingerprints.map((r) => r.file_path)).toEqual(['src/a.ts'])
  })

  it('writes only the fingerprints a full rebuild changed', async () => {
    const rows = [fileRow('src/a.ts'), fileRow('src/b.ts')]
    const current = fingerprintFile(rows[0] as unknown as IndexedFileRow)
    const db = dbWith({
      codebase_analyze_jobs: [pushJob('job-1', { changed_paths: null })],
      project_codebase_files: rows,
      project_codebase_fingerprints: [
        // jsonb does not keep key order, so the stored object is spelled in
        // another one: the comparison must be by value.
        {
          project_id: P,
          file_path: 'src/a.ts',
          fingerprint: {
            importCount: current.importCount,
            exportCount: current.exportCount,
            contentHash: current.contentHash,
            filePath: current.filePath,
          },
          updated_at: 'before',
        },
        {
          project_id: P,
          file_path: 'src/b.ts',
          fingerprint: { ...fingerprintFile(rows[1] as unknown as IndexedFileRow), contentHash: 'stale' },
          updated_at: 'before',
        },
      ],
    })
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'completed' })
    const stored = db.tables.project_codebase_fingerprints
    expect(stored.find((r) => r.file_path === 'src/a.ts')?.updated_at).toBe('before')
    expect(stored.find((r) => r.file_path === 'src/b.ts')?.updated_at).not.toBe('before')
  })

  it('writes every fingerprint when the stored read fails', async () => {
    const db = makeFakeDb(
      {
        codebase_analyze_jobs: [pushJob('job-1', { changed_paths: null })],
        projects: [{ id: P, name: 'glot.it' }],
        project_repos: [{ project_id: P, is_primary: true, commit_sha: 'abc123' }],
        project_codebase_files: [fileRow('src/a.ts'), fileRow('src/b.ts')],
        project_codebase_graph: [],
      },
      { failRead: (t) => (t === 'project_codebase_fingerprints' ? 'read failed' : null) },
    )
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'completed' })
    expect(db.tables.project_codebase_fingerprints.map((r) => r.file_path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('requeues when a recent analyze for the same project is already running', async () => {
    const db = dbWith({
      codebase_analyze_jobs: [
        pushJob('job-1'),
        pushJob('job-2', { status: 'running', started_at: new Date().toISOString() }),
      ],
    })
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'skipped' })
    const job = db.tables.codebase_analyze_jobs.find((r) => r.id === 'job-1')
    expect(job).toMatchObject({ status: 'queued', started_at: null })
  })

  it('requeues when the graph write lock is busy', async () => {
    const db = dbWith()
    db.rpc = async (fn: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, args })
      return { data: null, error: { code: '55P03', message: 'graph_write_busy' } }
    }
    const result = await runner.runCodebaseAnalyzeJob(db as never, 'job-1')
    expect(result).toMatchObject({ ok: true, status: 'skipped', error: 'graph write busy' })
    expect(db.tables.codebase_analyze_jobs[0]).toMatchObject({ status: 'queued' })
    expect(db.rpcCalls).toHaveLength(1)
  })
})

/**
 * A whole-index rebuild writes the freshly built graph and never reads the
 * stored document, so a second writer's nodes would vanish on the next push.
 * These pin the invariant the rebuild branch relies on.
 */
describe('project_codebase_graph has one writer', () => {
  const functionsDir = resolve(__dirname, '../../supabase/functions')

  function tsFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) out.push(...tsFiles(full))
      else if (entry.name.endsWith('.ts')) out.push(full)
    }
    return out
  }

  it('is only ever read through the table, never inserted or updated', () => {
    const writes: string[] = []
    const rpcCallers: string[] = []
    const graphWriteCallers: string[] = []
    for (const file of tsFiles(functionsDir)) {
      const src = readFileSync(file, 'utf8')
      const where = relative(functionsDir, file).replaceAll('\\', '/')
      for (const m of src.matchAll(/\.from\(\s*'project_codebase_graph'\s*\)\s*\.(\w+)/g)) {
        if (m[1] !== 'select') writes.push(`${where}: .${m[1]}()`)
      }
      if (/\brpc\(\s*'write_codebase_graph'/.test(src)) rpcCallers.push(where)
      if (/\bawait writeCodebaseGraph\(/.test(src)) graphWriteCallers.push(where)
    }
    expect(writes).toEqual([])
    expect(rpcCallers).toEqual(['_shared/codebase-graph-write.ts'])
    expect(graphWriteCallers).toEqual(['_shared/codebase-analyze-runner.ts'])
  })

  it('is written in SQL only by the write_codebase_graph function', () => {
    const migrationsDir = resolve(__dirname, '../../supabase/migrations')
    const offenders = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => {
        const sql = readFileSync(resolve(migrationsDir, f), 'utf8')
        const writesGraph = /\b(insert\s+into|update)\s+(public\.)?project_codebase_graph\b/i.test(sql)
        return writesGraph && !/function\s+public\.write_codebase_graph/i.test(sql)
      })
    expect(offenders).toEqual([])
  })
})

describe('write_codebase_graph migration', () => {
  it('serializes the write, raises the timeout, and compresses with lz4', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20261020123834_codebase_graph_write_lock.sql'),
      'utf8',
    )
    expect(sql).toMatch(/set statement_timeout = '90s'/)
    expect(sql).toMatch(/pg_try_advisory_xact_lock/)
    expect(sql).toMatch(/graph_write_busy/)
    expect(sql).toMatch(/errcode = '55P03'/)
    expect(sql).toMatch(/set compression lz4/)
    expect(sql).toMatch(/grant execute on function public\.write_codebase_graph\(uuid, text, text, jsonb\) to service_role/)
  })
})
