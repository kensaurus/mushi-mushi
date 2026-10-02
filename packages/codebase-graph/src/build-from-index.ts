import type { IndexedFileRow, KnowledgeGraph, KnowledgeGraphEdge, KnowledgeGraphNode } from './types'

const IMPORT_RE = /(?:import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g

function resolveRelative(fromPath: string, importPath: string): string {
  const dir = fromPath.split('/').slice(0, -1).join('/')
  const segments = [...(dir ? dir.split('/') : []), ...importPath.split('/')]
  const resolved: string[] = []
  for (const seg of segments) {
    if (seg === '..') resolved.pop()
    else if (seg !== '.') resolved.push(seg)
  }
  return resolved.join('/')
}

function detectLayer(filePath: string): string {
  const p = filePath.toLowerCase().replace(/\\/g, '/')
  if (/(^|\/)(tests?|__tests?__|spec)\//.test(p)) return 'test'
  if (/(^|\/)(server|api|supabase\/functions|backend)\//.test(p)) return 'backend'
  if (/\.(tsx|jsx)$/.test(p) || /(^|\/)(app|pages?|components?)\//.test(p)) return 'ui'
  if (/(^|\/)(lib|utils?|hooks?|shared)\//.test(p)) return 'lib'
  if (/\.(json|yaml|yml|toml|mjs)$/.test(p)) return 'config'
  return 'other'
}

/** Relative import specifiers in `content`, in order, without duplicates. */
export function extractRelativeImports(content: string): string[] {
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const p = m[1] ?? m[2]
    if (p && p.startsWith('.')) seen.add(p)
  }
  return [...seen]
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']

function resolveImportTarget(pathToId: Map<string, string>, fromPath: string, imp: string): string | undefined {
  const resolved = resolveRelative(fromPath, imp)
  // TS ESM imports name the emitted file: './x.js' is ./x.ts on disk.
  const bases = /\.jsx?$/.test(resolved) ? [resolved, resolved.replace(/\.jsx?$/, '')] : [resolved]
  for (const base of bases) {
    for (const suffix of RESOLVE_SUFFIXES) {
      const id = pathToId.get(base + suffix)
      if (id) return id
    }
  }
  return undefined
}

/**
 * Build a UA-shaped graph from indexed file rows (file + symbol nodes).
 *
 * Every indexed path gets a file node. A file whose chunks all carry a symbol
 * has no symbol-less row, so it gets a synthetic `file:<path>` node; before,
 * such files had no node and lost every import edge. Imports come from each
 * row's `imports` (extracted from the whole file at index time), falling back
 * to the 600-character preview of a symbol-less row for rows indexed before
 * that column existed.
 */
export function buildGraphFromIndex(args: {
  projectName: string
  commitSha?: string | null
  fileRows: IndexedFileRow[]
  symbolRows?: IndexedFileRow[]
}): KnowledgeGraph {
  const nodes: KnowledgeGraphNode[] = []
  const edges: KnowledgeGraphEdge[] = []
  const pathToId = new Map<string, string>()
  const languages = new Set<string>()

  const plainRows = args.fileRows.filter((r) => !r.symbol_name)
  const symbolRows = (args.symbolRows ?? args.fileRows).filter((r) => r.symbol_name)

  const pushFileNode = (id: string, row: IndexedFileRow, summary: string | undefined) => {
    pathToId.set(row.file_path, id)
    if (row.language) languages.add(row.language)
    nodes.push({
      id,
      type: 'file',
      name: row.file_path.split('/').pop() ?? row.file_path,
      filePath: row.file_path,
      summary,
      tags: [detectLayer(row.file_path)],
      metadata: { layer: detectLayer(row.file_path) },
    })
  }

  for (const row of plainRows) {
    if (pathToId.has(row.file_path)) continue
    pushFileNode(row.id, row, row.content_preview?.slice(0, 240) ?? undefined)
  }
  for (const row of symbolRows) {
    if (!pathToId.has(row.file_path)) pushFileNode(`file:${row.file_path}`, row, undefined)
  }

  for (const row of symbolRows) {
    nodes.push({
      id: row.id,
      type: 'function',
      name: row.symbol_name as string,
      filePath: row.file_path,
      lineRange:
        row.line_start != null && row.line_end != null
          ? [row.line_start, row.line_end]
          : undefined,
      summary: row.signature ?? undefined,
      metadata: { parentFile: row.file_path },
    })
    const fileId = pathToId.get(row.file_path)
    if (fileId) {
      edges.push({ source: fileId, target: row.id, type: 'contains', direction: 'directed' })
    }
  }

  const importsByPath = new Map<string, string[]>()
  for (const row of [...plainRows, ...symbolRows]) {
    if (row.imports && row.imports.length > 0 && !importsByPath.has(row.file_path)) {
      importsByPath.set(row.file_path, row.imports)
    }
  }
  for (const row of plainRows) {
    if (!importsByPath.has(row.file_path) && row.content_preview) {
      importsByPath.set(row.file_path, extractRelativeImports(row.content_preview))
    }
  }

  const seenEdges = new Set<string>()
  for (const [filePath, imports] of importsByPath) {
    const sourceId = pathToId.get(filePath)
    if (!sourceId) continue
    for (const imp of imports) {
      const targetId = resolveImportTarget(pathToId, filePath, imp)
      if (!targetId || targetId === sourceId) continue
      const key = `${sourceId}>${targetId}`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)
      edges.push({ source: sourceId, target: targetId, type: 'imports', direction: 'directed' })
    }
  }

  const layerMap = new Map<string, string[]>()
  for (const n of nodes.filter((x) => x.type === 'file')) {
    const layer = String(n.metadata?.layer ?? 'other')
    if (!layerMap.has(layer)) layerMap.set(layer, [])
    layerMap.get(layer)!.push(n.id)
  }

  return {
    version: '1.0.0',
    kind: 'codebase',
    project: {
      name: args.projectName,
      languages: [...languages],
      frameworks: [],
      analyzedAt: new Date().toISOString(),
      gitCommitHash: args.commitSha ?? undefined,
    },
    nodes,
    edges,
    layers: [...layerMap.entries()].map(([id, nodeIds]) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      nodeIds,
    })),
  }
}

/**
 * Replace the changed files' nodes and keep the rest. An edge from the new
 * build survives when both its ends exist in the merged graph — an import
 * from a changed file to an unchanged one used to be dropped because only
 * edges between two changed files were kept.
 */
export function mergeGraphUpdate(
  existing: KnowledgeGraph | null,
  next: KnowledgeGraph,
  changedPaths: string[],
): KnowledgeGraph {
  if (!existing || changedPaths.length === 0) return next
  const changed = new Set(changedPaths)
  const keptNodes = existing.nodes.filter((n) => !n.filePath || !changed.has(n.filePath))
  const keptIds = new Set(keptNodes.map((n) => n.id))
  const newNodes = next.nodes.filter((n) => !keptIds.has(n.id))
  const allIds = new Set([...keptIds, ...newNodes.map((n) => n.id)])
  const keptEdges = existing.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
  const keptEdgeKeys = new Set(keptEdges.map((e) => `${e.source}>${e.target}>${e.type}`))
  const newEdges = next.edges.filter(
    (e) =>
      allIds.has(e.source) &&
      allIds.has(e.target) &&
      !keptEdgeKeys.has(`${e.source}>${e.target}>${e.type}`),
  )
  return {
    ...next,
    nodes: [...keptNodes, ...newNodes],
    edges: [...keptEdges, ...newEdges],
    layers: next.layers,
  }
}
