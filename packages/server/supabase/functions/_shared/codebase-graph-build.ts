/**
 * Deno-compatible graph builder (mirrors @mushi-mushi/codebase-graph).
 * Concepts from Understand-Anything @understand-anything/core (MIT).
 */

export interface IndexedFileRow {
  id: string
  file_path: string
  symbol_name: string | null
  signature: string | null
  line_start: number | null
  line_end: number | null
  language: string | null
  content_preview: string | null
  content_hash?: string | null
}

export interface KnowledgeGraphNode {
  id: string
  type: string
  name: string
  filePath?: string
  lineRange?: [number, number]
  summary?: string
  tags?: string[]
  languageNotes?: string[]
  metadata?: Record<string, unknown>
}

export interface KnowledgeGraphEdge {
  source: string
  target: string
  type: string
  direction?: 'directed' | 'undirected'
}

export interface KnowledgeGraph {
  version: string
  kind: 'codebase' | 'knowledge'
  project: {
    name: string
    languages: string[]
    frameworks: string[]
    analyzedAt: string
    gitCommitHash?: string
  }
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  layers: Array<{ id: string; name: string; nodeIds: string[] }>
}

const IMPORT_RE = /(?:import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g
const EXPORT_RE = /^\s*export\s+/m

export function fingerprintFile(row: IndexedFileRow) {
  const preview = row.content_preview ?? ''
  let importCount = 0
  let m: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(preview)) !== null) {
    if (m[1] ?? m[2]) importCount++
  }
  return {
    filePath: row.file_path,
    contentHash: row.content_hash ?? hashString(preview),
    exportCount: (preview.match(EXPORT_RE) ?? []).length,
    importCount,
  }
}

function hashString(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

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
      edges.push({ source: fileId, target: row.id, type: 'contains', direction: 'directed' })
    }
  }

  for (const row of args.fileRows.filter((r) => !r.symbol_name && r.content_preview)) {
    const preview = row.content_preview as string
    for (const imp of extractImports(preview)) {
      const resolved = resolveRelative(row.file_path, imp)
      const targetId =
        pathToId.get(resolved) ??
        pathToId.get(resolved + '.ts') ??
        pathToId.get(resolved + '.tsx') ??
        pathToId.get(resolved + '/index.ts')
      if (!targetId || targetId === row.id) continue
      edges.push({ source: row.id, target: targetId, type: 'imports', direction: 'directed' })
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

export function mergeGraphUpdate(
  existing: KnowledgeGraph | null,
  next: KnowledgeGraph,
  changedPaths: string[],
): KnowledgeGraph {
  if (!existing || changedPaths.length === 0) return next
  const changed = new Set(changedPaths)
  const keptNodes = existing.nodes.filter((n) => !n.filePath || !changed.has(n.filePath))
  const keptIds = new Set(keptNodes.map((n) => n.id))
  const keptEdges = existing.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
  const newNodes = next.nodes.filter((n) => !n.filePath || changed.has(n.filePath) || !keptIds.has(n.id))
  const newNodeIds = new Set(newNodes.map((n) => n.id))
  const newEdges = next.edges.filter((e) => newNodeIds.has(e.source) && newNodeIds.has(e.target))
  return {
    ...next,
    nodes: [...keptNodes, ...newNodes],
    edges: [...keptEdges, ...newEdges],
    layers: next.layers,
  }
}
