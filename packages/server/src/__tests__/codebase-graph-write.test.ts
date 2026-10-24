/**
 * Graph upsert used to die with SQLSTATE 57014 (Sentry 7786063319).
 * Pins: dead file nodes are not written back, a live sibling is requeued,
 * a busy advisory lock is requeued, and a statement timeout is tried once.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type Row } from './__stubs__/fake-supabase.ts'
import { listIndexedFilePaths, pruneGraphToLivePaths, writeCodebaseGraph } from '../../supabase/functions/_shared/codebase-graph-write.ts'
import type { KnowledgeGraph } from '../../supabase/functions/_shared/codebase-graph-build.ts'
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
