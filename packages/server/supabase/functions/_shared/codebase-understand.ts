/**
 * Pure helpers for codebase Understand features — chat prompts, tour ordering,
 * import-impact analysis. Imported by api/routes/codebase-understand.ts and
 * unit-tested from packages/server/src/__tests__/codebase-understand.test.ts.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createEmbedding } from './embeddings.ts'
import { formatCodeContext, type CodeContext } from './rag.ts'

export interface CodebaseCitation {
  file_path: string
  line_start: number | null
  line_end: number | null
  symbol_name: string | null
  similarity?: number
}

export interface ExploreGraphNode {
  id: string
  label: string
  node_type: 'code_file' | 'code_symbol'
  metadata: {
    file_path: string
    symbol_name: string | null
    layer: string
    content_preview: string | null
  }
}

export interface ExploreGraphEdge {
  id: string
  source_node_id: string
  target_node_id: string
  edge_type: string
}

export interface TourStop {
  order: number
  title: string
  rationale: string
  node_ids: string[]
  file_paths: string[]
  layer: string
}

export interface DomainStep {
  id: string
  name: string
  description: string
  file_paths: string[]
}

export interface DomainFlow {
  id: string
  name: string
  description: string
  steps: DomainStep[]
}

export interface DomainView {
  id: string
  name: string
  description: string
  flows: DomainFlow[]
}

const IMPORT_RE = /(?:import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g

export function extractRelativeImports(content: string): string[] {
  const imports: string[] = []
  let m: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const p = m[1] ?? m[2]
    if (p && p.startsWith('.')) imports.push(p)
  }
  return imports
}

export function resolveRelative(fromPath: string, importPath: string): string {
  const dir = fromPath.split('/').slice(0, -1).join('/')
  const segments = [...(dir ? dir.split('/') : []), ...importPath.split('/')]
  const resolved: string[] = []
  for (const seg of segments) {
    if (seg === '..') resolved.pop()
    else if (seg !== '.') resolved.push(seg)
  }
  return resolved.join('/')
}

export function buildImportEdges(
  rows: Array<{ id: string; file_path: string; symbol_name: string | null; content_preview: string | null }>,
): ExploreGraphEdge[] {
  const nodeByPath = new Map(
    rows.filter((r) => !r.symbol_name).map((r) => [r.file_path, r.id]),
  )
  const edges: ExploreGraphEdge[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row.content_preview) continue
    for (const imp of extractRelativeImports(row.content_preview)) {
      const resolved = resolveRelative(row.file_path, imp)
      const targetId =
        nodeByPath.get(resolved) ??
        nodeByPath.get(resolved + '.ts') ??
        nodeByPath.get(resolved + '.tsx') ??
        nodeByPath.get(resolved + '.js') ??
        nodeByPath.get(resolved + '/index.ts') ??
        nodeByPath.get(resolved + '/index.tsx')
      if (!targetId || targetId === row.id) continue
      const key = `${row.id}→${targetId}`
      if (seen.has(key) || edges.length >= 2000) continue
      seen.add(key)
      edges.push({
        id: key,
        source_node_id: row.id,
        target_node_id: targetId,
        edge_type: 'imports',
      })
    }
  }
  return edges
}

/** Topological-ish ordering: config/lib first, ui/backend next, tests last. */
export function orderTourStops(
  nodes: ExploreGraphNode[],
  edges: ExploreGraphEdge[],
  maxStops = 10,
): TourStop[] {
  const fileNodes = nodes.filter((n) => n.node_type === 'code_file')
  if (fileNodes.length === 0) return []

  const inDegree = new Map<string, number>()
  const outEdges = new Map<string, string[]>()
  for (const n of fileNodes) {
    inDegree.set(n.id, 0)
    outEdges.set(n.id, [])
  }
  for (const e of edges) {
    if (!inDegree.has(e.source_node_id) || !inDegree.has(e.target_node_id)) continue
    inDegree.set(e.target_node_id, (inDegree.get(e.target_node_id) ?? 0) + 1)
    outEdges.get(e.source_node_id)!.push(e.target_node_id)
  }

  const layerRank: Record<string, number> = {
    config: 0,
    lib: 1,
    backend: 2,
    ui: 3,
    other: 4,
    test: 5,
  }

  const sorted = [...fileNodes].sort((a, b) => {
    const la = layerRank[a.metadata.layer] ?? 4
    const lb = layerRank[b.metadata.layer] ?? 4
    if (la !== lb) return la - lb
    return (inDegree.get(a.id) ?? 0) - (inDegree.get(b.id) ?? 0)
  })

  const picked: ExploreGraphNode[] = []
  const seenLayers = new Set<string>()
  for (const n of sorted) {
    if (picked.length >= maxStops) break
    const layer = n.metadata.layer
    if (seenLayers.has(layer) && picked.length >= 3) continue
    picked.push(n)
    seenLayers.add(layer)
  }
  while (picked.length < Math.min(maxStops, fileNodes.length)) {
    const next = sorted.find((n) => !picked.includes(n))
    if (!next) break
    picked.push(next)
  }

  return picked.map((n, i) => ({
    order: i + 1,
    title: n.label,
    rationale: tourRationale(n.metadata.layer, inDegree.get(n.id) ?? 0, outEdges.get(n.id)?.length ?? 0),
    node_ids: [n.id],
    file_paths: [n.metadata.file_path],
    layer: n.metadata.layer,
  }))
}

function tourRationale(layer: string, inCount: number, outCount: number): string {
  const layerHint: Record<string, string> = {
    config: 'Configuration and tooling — start here to see how the project is wired.',
    lib: 'Shared library code — utilities and helpers other layers depend on.',
    backend: 'Server/API layer — where business logic and data access live.',
    ui: 'User-facing surfaces — pages, components, and screens.',
    test: 'Test coverage — how behaviour is verified.',
    other: 'Supporting code — review to see how it connects to the rest.',
  }
  const base = layerHint[layer] ?? layerHint.other
  if (inCount === 0 && outCount > 0) return `${base} Nothing imports this file yet — it is a root of the dependency tree.`
  if (outCount === 0) return `${base} A leaf node — few outgoing dependencies.`
  return `${base} ${inCount} incoming · ${outCount} outgoing import${outCount === 1 ? '' : 's'}.`
}

/** Find all nodes that transitively depend on changed file paths. */
export function computeImportImpact(
  changedPaths: string[],
  nodes: ExploreGraphNode[],
  edges: ExploreGraphEdge[],
): { affected_node_ids: string[]; affected_file_paths: string[] } {
  const normalized = new Set(changedPaths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')))
  const fileNodes = nodes.filter((n) => n.node_type === 'code_file')
  const pathToId = new Map(fileNodes.map((n) => [n.metadata.file_path, n.id]))
  const idToPath = new Map(fileNodes.map((n) => [n.id, n.metadata.file_path]))

  const seedIds = new Set<string>()
  for (const p of normalized) {
    const id = pathToId.get(p)
    if (id) seedIds.add(id)
  }

  const reverse = new Map<string, string[]>()
  for (const e of edges) {
    if (!reverse.has(e.target_node_id)) reverse.set(e.target_node_id, [])
    reverse.get(e.target_node_id)!.push(e.source_node_id)
  }

  const affected = new Set<string>(seedIds)
  const queue = [...seedIds]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const src of reverse.get(cur) ?? []) {
      if (affected.has(src)) continue
      affected.add(src)
      queue.push(src)
    }
  }

  const affectedIds = [...affected]
  const affectedPaths = affectedIds
    .map((id) => idToPath.get(id))
    .filter((p): p is string => !!p)

  return { affected_node_ids: affectedIds, affected_file_paths: affectedPaths }
}

export function hitsToCitations(hits: CodeContext[]): CodebaseCitation[] {
  return hits.map((h) => ({
    file_path: h.filePath,
    line_start: h.lineStart ?? null,
    line_end: h.lineEnd ?? null,
    symbol_name: h.symbolName ?? null,
    similarity: h.similarity,
  }))
}

export function buildCodebaseChatSystemPrompt(args: {
  projectName: string | null
  codeContext: string
  citations: CodebaseCitation[]
  fileFocus?: { file_path: string; symbol_name?: string | null } | null
}): string {
  const focusLine = args.fileFocus
    ? `\nThe user is focused on \`${args.fileFocus.file_path}${args.fileFocus.symbol_name ? `#${args.fileFocus.symbol_name}` : ''}\`. Prioritize explaining that file/symbol.\n`
    : ''

  return [
    'You are a codebase understanding assistant for the Mushi admin console.',
    'Answer questions about the indexed repository using ONLY the code context below.',
    'Be plain-English, concise, and actionable. Use markdown for structure.',
    'When referencing code, cite paths like `path/to/file.ts:42` matching the citations list.',
    'If the context is insufficient, say what is missing and suggest enabling indexing or asking a narrower question.',
    '',
    `Project: ${args.projectName ?? 'unknown'}`,
    focusLine,
    '--- Retrieved code context ---',
    args.codeContext || '(no matching code chunks — index may be empty or query too vague)',
    '',
    '--- Citations (use these paths in your answer) ---',
    args.citations.length
      ? args.citations
          .map(
            (c) =>
              `- ${c.file_path}${c.line_start != null ? `:${c.line_start}` : ''}${c.symbol_name ? ` :: ${c.symbol_name}` : ''}`,
          )
          .join('\n')
      : '(none)',
  ].join('\n')
}

export function buildSummaryPrompt(args: {
  file_path: string
  symbol_name: string | null
  signature: string | null
  layer: string
  content: string
}): string {
  const target = args.symbol_name
    ? `symbol \`${args.symbol_name}\` in \`${args.file_path}\``
    : `file \`${args.file_path}\``
  return [
    `Explain ${target} in plain English for a developer onboarding to this codebase.`,
    'Cover: (1) what it is, (2) what it does in the app, (3) key relationships to other parts.',
    `Architectural layer: ${args.layer}.`,
    args.signature ? `Signature: ${args.signature}` : '',
    '',
    '--- Code preview ---',
    args.content.slice(0, 4000),
  ]
    .filter(Boolean)
    .join('\n')
}

export function isSummaryStale(cachedHash: string | null, currentHash: string | null): boolean {
  if (!cachedHash || !currentHash) return true
  return cachedHash !== currentHash
}

export async function retrieveCodeForQuestion(
  db: SupabaseClient,
  projectId: string,
  query: string,
  k = 12,
): Promise<{ files: CodeContext[]; reason: string }> {
  const trimmed = query.trim()
  if (!trimmed) return { files: [], reason: 'empty_query' }

  let embedding: number[]
  try {
    embedding = await createEmbedding(trimmed, { projectId })
  } catch {
    return { files: [], reason: 'embedding_failed' }
  }

  const { data: hits, error } = await db.rpc('match_codebase_files', {
    query_embedding: embedding,
    match_project: projectId,
    match_count: k,
  })
  if (error) return { files: [], reason: 'rpc_failed' }

  const mapped = (hits ?? []).map((f: Record<string, unknown>) => ({
    filePath: f.file_path as string,
    preview: f.content_preview as string,
    componentTag: f.component_tag as string | undefined,
    similarity: f.similarity as number,
    symbolName: (f.symbol_name as string | null | undefined) ?? null,
    signature: (f.signature as string | null | undefined) ?? null,
    lineStart: (f.line_start as number | null | undefined) ?? null,
    lineEnd: (f.line_end as number | null | undefined) ?? null,
  }))

  if (mapped.length === 0) return { files: [], reason: 'no_matches' }
  return { files: mapped, reason: 'ok' }
}

export async function getIndexFingerprint(
  db: SupabaseClient,
  projectId: string,
): Promise<string> {
  const { count } = await db
    .from('project_codebase_files')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .is('tombstoned_at', null)

  const { data: latest } = await db
    .from('project_codebase_files')
    .select('indexed_at')
    .eq('project_id', projectId)
    .is('tombstoned_at', null)
    .order('indexed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return `${count ?? 0}:${latest?.indexed_at ?? 'none'}`
}

export async function loadExploreGraph(
  db: SupabaseClient,
  projectId: string,
): Promise<{ nodes: ExploreGraphNode[]; edges: ExploreGraphEdge[] }> {
  const { data: rows } = await db
    .from('project_codebase_files')
    .select('id, file_path, symbol_name, signature, line_start, line_end, language, content_preview, last_modified')
    .eq('project_id', projectId)
    .is('tombstoned_at', null)
    .is('symbol_name', null)
    .order('file_path')
    .limit(5000)

  const fileRows = rows ?? []
  type ExploreLayer = 'ui' | 'lib' | 'backend' | 'test' | 'config' | 'other'

  function detectLayer(filePath: string): ExploreLayer {
    const p = filePath.toLowerCase().replace(/\\/g, '/')
    if (/(^|\/)(tests?|__tests?__|spec|e2e|cypress|playwright)\//.test(p) || /\.(test|spec)\.[jt]sx?$/.test(p)) return 'test'
    if (/(^|\/)(server|api|edge-function|supabase\/functions|backend|routes?)\//.test(p)) return 'backend'
    if (/(^|\/)(app|pages?|screens?|views?|components?|layouts?|ui)\//u.test(p) || /\.(tsx|jsx)$/u.test(p)) return 'ui'
    if (/(^|\/)(lib|libs?|utils?|helpers?|hooks?|contexts?|shared|common|core)\//u.test(p)) return 'lib'
    if (/(^|\/)(config|configs?|tooling|scripts?|deploy|\.github|build)\//u.test(p) || /\.(json|yaml|yml|toml|mjs|cjs)$/u.test(p)) return 'config'
    return 'other'
  }

  const nodes: ExploreGraphNode[] = fileRows.map((r) => ({
    id: r.id,
    node_type: 'code_file' as const,
    label: r.file_path.split('/').pop() ?? r.file_path,
    metadata: {
      file_path: r.file_path,
      symbol_name: null,
      layer: detectLayer(r.file_path),
      content_preview: r.content_preview ?? null,
    },
  }))

  const edges = buildImportEdges(fileRows)
  return { nodes, edges }
}

export function formatContextBlock(files: CodeContext[]): string {
  return formatCodeContext(files)
}
