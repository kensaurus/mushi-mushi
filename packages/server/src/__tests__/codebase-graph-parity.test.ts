/**
 * FILE: codebase-graph-parity.test.ts
 * PURPOSE: One behaviour for the two graph builders.
 *
 * `_shared/codebase-graph-build.ts` (Deno, used by codebase-analyze-worker)
 * is a hand copy of `packages/codebase-graph/src/build-from-index.ts`. The
 * edge runtime cannot import the workspace package, so the copy stays; this
 * test runs both on the same fixtures and fails on any drift (Plan 020 §10.2
 * blocker 7). It also pins the two import-edge losses fixed on 2026-10-02:
 * files whose chunks all carry a symbol had no file node, and an incremental
 * merge dropped imports from a changed file to an unchanged one.
 */

import { describe, it, expect } from 'vitest'
import * as deno from '../../supabase/functions/_shared/codebase-graph-build.ts'
import * as pkg from '../../../codebase-graph/src/build-from-index'
import { fingerprintFile as pkgFingerprint } from '../../../codebase-graph/src/fingerprint'
import type { IndexedFileRow } from '../../../codebase-graph/src/types'

function row(p: Partial<IndexedFileRow> & { id: string; file_path: string }): IndexedFileRow {
  return {
    symbol_name: null,
    signature: null,
    line_start: null,
    line_end: null,
    language: 'ts',
    content_preview: null,
    content_hash: null,
    ...p,
  }
}

const FIXTURES: Record<string, IndexedFileRow[]> = {
  // Every chunk of these files carries a symbol: no symbol-less row exists.
  symbolOnlyFiles: [
    row({ id: 's1', file_path: 'src/app.ts', symbol_name: 'main', line_start: 3, line_end: 9, imports: ['./lib/util', './api.js'] }),
    row({ id: 's2', file_path: 'src/lib/util.ts', symbol_name: 'util', line_start: 1, line_end: 4, imports: [] }),
    row({ id: 's3', file_path: 'src/api.ts', symbol_name: 'call', line_start: 1, line_end: 4, imports: ['./lib/util'] }),
  ],
  // Rows indexed before the imports column existed: preview fallback.
  legacyPreview: [
    row({ id: 'f1', file_path: 'a/index.ts', content_preview: "import { b } from './b'\nimport x from 'react'" }),
    row({ id: 'f2', file_path: 'a/b.ts', content_preview: 'export const b = 1' }),
  ],
  mixed: [
    row({ id: 'f1', file_path: 'web/page.tsx', content_preview: 'export default function Page() {}', imports: ['./hooks'] }),
    row({ id: 's1', file_path: 'web/page.tsx', symbol_name: 'Page', imports: ['./hooks'] }),
    row({ id: 's2', file_path: 'web/hooks/index.ts', symbol_name: 'useThing', imports: [] }),
  ],
}

function build(impl: typeof deno, rows: IndexedFileRow[]) {
  const g = impl.buildGraphFromIndex({
    projectName: 'fixture',
    commitSha: 'abc',
    fileRows: rows.filter((r) => !r.symbol_name),
    symbolRows: rows.filter((r) => r.symbol_name),
  })
  return { ...g, project: { ...g.project, analyzedAt: 'fixed' } }
}

describe('codebase graph builders agree', () => {
  for (const [name, rows] of Object.entries(FIXTURES)) {
    it(`same graph for ${name}`, () => {
      expect(build(deno, rows)).toEqual(build(pkg as unknown as typeof deno, rows))
    })
  }

  it('same fingerprints', () => {
    for (const rows of Object.values(FIXTURES)) {
      for (const r of rows) expect(deno.fingerprintFile(r)).toEqual(pkgFingerprint(r))
    }
  })

  it('same relative-import extraction', () => {
    const src = "import a from './a'\nimport b from 'b'\nconst c = require('../c')\nimport a2 from './a'"
    expect(deno.extractRelativeImports(src)).toEqual(['./a', '../c'])
    expect(pkg.extractRelativeImports(src)).toEqual(['./a', '../c'])
  })

  it('same incremental merge', () => {
    const before = build(deno, FIXTURES.symbolOnlyFiles)
    const after = build(deno, FIXTURES.symbolOnlyFiles.map((r) => (r.id === 's1' ? { ...r, line_end: 12 } : r)))
    expect(deno.mergeGraphUpdate(before, after, ['src/app.ts'])).toEqual(
      pkg.mergeGraphUpdate(before as never, after as never, ['src/app.ts']),
    )
  })
})

describe('import edges are not lost', () => {
  it('files whose chunks all carry a symbol still get a file node and their import edges', () => {
    const g = build(deno, FIXTURES.symbolOnlyFiles)
    const files = g.nodes.filter((n) => n.type === 'file').map((n) => n.filePath)
    expect(files.sort()).toEqual(['src/api.ts', 'src/app.ts', 'src/lib/util.ts'])
    const imports = g.edges.filter((e) => e.type === 'imports').map((e) => `${e.source} -> ${e.target}`)
    expect(imports.sort()).toEqual([
      'file:src/api.ts -> file:src/lib/util.ts',
      // './api.js' resolves to src/api.ts (TS ESM specifier).
      'file:src/app.ts -> file:src/api.ts',
      'file:src/app.ts -> file:src/lib/util.ts',
    ])
    expect(g.edges.filter((e) => e.type === 'contains')).toHaveLength(3)
  })

  it('legacy rows keep the preview fallback', () => {
    const g = build(deno, FIXTURES.legacyPreview)
    expect(g.edges).toEqual([{ source: 'f1', target: 'f2', type: 'imports', direction: 'directed' }])
  })

  it('a directory import resolves to its index file', () => {
    const g = build(deno, FIXTURES.mixed)
    expect(g.edges.filter((e) => e.type === 'imports')).toEqual([
      { source: 'f1', target: 'file:web/hooks/index.ts', type: 'imports', direction: 'directed' },
    ])
  })

  it('an incremental merge keeps an import from a changed file to an unchanged one', () => {
    const before = build(deno, FIXTURES.symbolOnlyFiles)
    const next = build(deno, FIXTURES.symbolOnlyFiles)
    const merged = deno.mergeGraphUpdate(before, next, ['src/app.ts'])
    const imports = merged.edges.filter((e) => e.type === 'imports').map((e) => `${e.source} -> ${e.target}`)
    expect(imports).toContain('file:src/app.ts -> file:src/lib/util.ts')
    expect(imports).toContain('file:src/app.ts -> file:src/api.ts')
    // No duplicate nodes or edges after the merge.
    expect(new Set(merged.nodes.map((n) => n.id)).size).toBe(merged.nodes.length)
    expect(new Set(merged.edges.map((e) => `${e.source}>${e.target}>${e.type}`)).size).toBe(merged.edges.length)
  })
})
