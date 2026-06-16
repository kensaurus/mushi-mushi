/**
 * FILE: packages/codebase-graph/src/graph.test.ts
 * PURPOSE: Unit coverage for the pure knowledge-graph builder + fingerprint
 *          helpers. Locks in the observable behaviour of the exported API so
 *          the server-side mirror (_shared/codebase-graph-build.ts) and the
 *          /explore Codebase Atlas can rely on a stable contract.
 *
 * OVERVIEW:
 * - fingerprintFile / classifyFingerprintDelta / classifyBatchUpdate — the
 *   incremental-update classifier used to decide SKIP vs PARTIAL/FULL re-index.
 * - buildGraphFromIndex — turns indexed file + symbol rows into a UA-shaped
 *   KnowledgeGraph (file/function nodes, `contains` + relative `imports` edges).
 * - mergeGraphUpdate — incremental merge that keeps unchanged nodes/edges.
 *
 * DEPENDENCIES:
 * - vitest (test runner), ./fingerprint, ./build-from-index, ./types.
 *
 * NOTES:
 * - Assertions document the CURRENT behaviour (e.g. content-hash equality →
 *   SKIP). They are intentionally not over-specified where the implementation
 *   is deliberately coarse.
 */
import { describe, it, expect } from 'vitest'
import { fingerprintFile, classifyFingerprintDelta, classifyBatchUpdate } from './fingerprint'
import { buildGraphFromIndex, mergeGraphUpdate } from './build-from-index'
import type { IndexedFileRow } from './types'

function fileRow(
  partial: Partial<IndexedFileRow> & { id: string; file_path: string },
): IndexedFileRow {
  return {
    symbol_name: null,
    signature: null,
    line_start: null,
    line_end: null,
    language: 'typescript',
    content_preview: null,
    content_hash: null,
    ...partial,
  }
}

describe('fingerprintFile', () => {
  it('counts relative + bare imports and detects exports', () => {
    const fp = fingerprintFile(
      fileRow({
        id: 'f1',
        file_path: 'src/a.ts',
        content_preview: "import x from './a'\nimport { y } from 'b'\nexport const z = 1\n",
        content_hash: 'abc123',
      }),
    )
    expect(fp.filePath).toBe('src/a.ts')
    expect(fp.contentHash).toBe('abc123')
    expect(fp.importCount).toBe(2)
    expect(fp.exportCount).toBeGreaterThanOrEqual(1)
  })

  it('falls back to a deterministic content hash when none is provided', () => {
    const row = fileRow({ id: 'f2', file_path: 'src/b.ts', content_preview: 'const k = 1' })
    const a = fingerprintFile(row)
    const b = fingerprintFile(row)
    expect(a.contentHash).toBe(b.contentHash)
    expect(a.contentHash).not.toBe('')
  })
})

describe('classifyFingerprintDelta', () => {
  const base = { filePath: 'src/a.ts', contentHash: 'h1', exportCount: 1, importCount: 2 }

  it('treats a never-seen file as a partial update', () => {
    expect(classifyFingerprintDelta(undefined, base)).toBe('PARTIAL_UPDATE')
  })

  it('skips a file whose content hash is unchanged', () => {
    expect(classifyFingerprintDelta(base, { ...base })).toBe('SKIP')
  })

  it('re-indexes a file whose content hash changed', () => {
    expect(classifyFingerprintDelta(base, { ...base, contentHash: 'h2' })).toBe('PARTIAL_UPDATE')
  })
})

describe('classifyBatchUpdate', () => {
  it('returns SKIP when no tracked path changed', () => {
    const prior = new Map([['src/a.ts', { filePath: 'src/a.ts', contentHash: 'h1', exportCount: 0, importCount: 0 }]])
    const rows = [fileRow({ id: 'f1', file_path: 'src/a.ts', content_preview: '', content_hash: 'h1' })]
    const result = classifyBatchUpdate(['src/a.ts'], prior, rows)
    expect(result.classification).toBe('SKIP')
    expect(result.paths).toEqual([])
  })

  it('escalates to a FULL_UPDATE past the 50-path threshold', () => {
    const changed = Array.from({ length: 51 }, (_, i) => `src/f${i}.ts`)
    const rows = changed.map((p, i) => fileRow({ id: `id${i}`, file_path: p, content_preview: 'export const a = 1', content_hash: `h${i}` }))
    const result = classifyBatchUpdate(changed, new Map(), rows)
    expect(result.classification).toBe('FULL_UPDATE')
    expect(result.paths).toHaveLength(51)
  })
})

describe('buildGraphFromIndex', () => {
  it('produces file/function nodes with contains + relative imports edges', () => {
    const graph = buildGraphFromIndex({
      projectName: 'demo',
      commitSha: 'deadbeef',
      fileRows: [
        fileRow({ id: 'fa', file_path: 'src/a.ts', content_preview: "import { foo } from './b'\nexport const a = 1" }),
        fileRow({ id: 'fb', file_path: 'src/b.ts', content_preview: 'export function foo() {}' }),
      ],
      symbolRows: [
        fileRow({ id: 'sa', file_path: 'src/a.ts', symbol_name: 'a', signature: 'const a = 1', line_start: 2, line_end: 2 }),
      ],
    })

    expect(graph.version).toBe('1.0.0')
    expect(graph.kind).toBe('codebase')
    expect(graph.project.name).toBe('demo')
    expect(graph.project.gitCommitHash).toBe('deadbeef')
    expect(graph.project.languages).toContain('typescript')

    expect(graph.nodes.filter((n) => n.type === 'file')).toHaveLength(2)
    expect(graph.nodes.filter((n) => n.type === 'function')).toHaveLength(1)

    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'fa', target: 'sa', type: 'contains' }),
    )
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'fa', target: 'fb', type: 'imports' }),
    )
  })
})

describe('mergeGraphUpdate', () => {
  it('returns the next graph wholesale when there is no prior graph', () => {
    const next = buildGraphFromIndex({ projectName: 'demo', fileRows: [fileRow({ id: 'fa', file_path: 'src/a.ts' })] })
    expect(mergeGraphUpdate(null, next, ['src/a.ts'])).toBe(next)
  })

  it('keeps unchanged nodes and swaps in changed ones', () => {
    const existing = buildGraphFromIndex({
      projectName: 'demo',
      fileRows: [
        fileRow({ id: 'fa', file_path: 'src/a.ts' }),
        fileRow({ id: 'fb', file_path: 'src/b.ts' }),
      ],
    })
    const next = buildGraphFromIndex({
      projectName: 'demo',
      fileRows: [
        fileRow({ id: 'fa2', file_path: 'src/a.ts' }),
        fileRow({ id: 'fb', file_path: 'src/b.ts' }),
      ],
    })
    const merged = mergeGraphUpdate(existing, next, ['src/a.ts'])
    const paths = merged.nodes.map((n) => n.filePath)
    expect(paths).toContain('src/a.ts')
    expect(paths).toContain('src/b.ts')
    // the unchanged b node is preserved from `existing`
    expect(merged.nodes.some((n) => n.id === 'fb')).toBe(true)
  })
})
