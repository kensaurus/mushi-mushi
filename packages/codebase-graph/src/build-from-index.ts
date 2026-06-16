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

/** Build a UA-shaped graph from indexed file rows (file + symbol nodes). */
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

  for (const row of args.fileRows.filter((r) => !r.symbol_name)) {
    pathToId.set(row.file_path, row.id)
    if (row.language) languages.add(row.language)
    nodes.push({
      id: row.id,
      type: 'file',
      name: row.file_path.split('/').pop() ?? row.file_path,
      filePath: row.file_path,
      summary: row.content_preview?.slice(0, 240) ?? undefined,
      tags: [detectLayer(row.file_path)],
      metadata: { layer: detectLayer(row.file_path) },
    })
  }

  for (const row of args.symbolRows ?? args.fileRows.filter((r) => r.symbol_name)) {
    if (!row.symbol_name) continue
    nodes.push({
      id: row.id,
      type: 'function',
      name: row.symbol_name,
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
      edges.push({
        source: fileId,
        target: row.id,
        type: 'contains',
        direction: 'directed',
      })
    }
  }

  for (const row of args.fileRows.filter((r) => !r.symbol_name && r.content_preview)) {
    for (const imp of extractImports(row.content_preview ?? '')) {
      const resolved = resolveRelative(row.file_path, imp)
      const targetId =
        pathToId.get(resolved) ??
        pathToId.get(resolved + '.ts') ??
        pathToId.get(resolved + '.tsx') ??
        pathToId.get(resolved + '/index.ts')
      if (!targetId || targetId === row.id) continue
      edges.push({
        source: row.id,
        target: targetId,
        type: 'imports',
        direction: 'directed',
      })
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

function extractImports(content: string): string[] {
  const imports: string[] = []
  let m: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const p = m[1] ?? m[2]
    if (p && p.startsWith('.')) imports.push(p)
  }
  return imports
}

export function mergeGraphUpdate(
  existing: KnowledgeGraph | null,
  next: KnowledgeGraph,
  changedPaths: string[],
): KnowledgeGraph {
  if (!existing || changedPaths.length === 0) return next
  const changed = new Set(changedPaths)
  const keptNodes = existing.nodes.filter(
    (n) => !n.filePath || !changed.has(n.filePath),
  )
  const keptIds = new Set(keptNodes.map((n) => n.id))
  const keptEdges = existing.edges.filter(
    (e) => keptIds.has(e.source) && keptIds.has(e.target),
  )
  const newNodes = next.nodes.filter((n) => !n.filePath || changed.has(n.filePath) || !keptIds.has(n.id))
  const newNodeIds = new Set(newNodes.map((n) => n.id))
  const newEdges = next.edges.filter(
    (e) => newNodeIds.has(e.source) && newNodeIds.has(e.target),
  )
  return {
    ...next,
    nodes: [...keptNodes, ...newNodes],
    edges: [...keptEdges, ...newEdges],
    layers: next.layers,
  }
}
