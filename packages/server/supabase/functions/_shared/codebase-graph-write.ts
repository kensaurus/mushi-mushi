/**
 * FILE: codebase-graph-write.ts
 * PURPOSE: Write project_codebase_graph without burning the statement timeout.
 *
 * OVERVIEW:
 * - The graph is one jsonb row. Two analyze jobs for one project used to
 *   block on that row until Postgres cancelled the statement (57014).
 * - Incremental merges kept nodes for files that had left the index, so the
 *   document only grew and the upsert got slower.
 *
 * DEPENDENCIES:
 * - Supabase client rpc `write_codebase_graph`
 * - KnowledgeGraph from codebase-graph-build.ts
 *
 * USAGE:
 * - codebase-analyze-runner.ts calls listIndexedFilePaths, pruneGraphToLivePaths,
 *   and writeCodebaseGraph around the graph upsert.
 *
 * NOTES:
 * - A statement timeout is retried once. A busy project lock is not: the
 *   caller requeues the job. A second full timeout can outlive the edge
 *   wall clock; the stale-job reaper picks that up.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { KnowledgeGraph } from './codebase-graph-build.ts'

const PATH_PAGE = 1000
/** 100k rows. A full last page means the read was cut off — fail open. */
const MAX_PATH_PAGES = 100
const WRITE_ATTEMPTS = 2

type DbError = { code?: string | null; message?: string } | null

export function pruneGraphToLivePaths(
  graph: KnowledgeGraph,
  livePaths: ReadonlySet<string>,
): KnowledgeGraph {
  // An empty path set means the lookup failed open or the index is empty.
  // Wiping a non-empty graph on an empty lookup would drop a good map.
  if (livePaths.size === 0) return graph
  const nodes = graph.nodes.filter((n) => !n.filePath || livePaths.has(n.filePath))
  if (nodes.length === graph.nodes.length) return graph
  const ids = new Set(nodes.map((n) => n.id))
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    layers: graph.layers.map((layer) => ({
      ...layer,
      nodeIds: layer.nodeIds.filter((id) => ids.has(id)),
    })),
  }
}

/** Every non-tombstoned path, paged so PostgREST max_rows cannot truncate it. */
export async function listIndexedFilePaths(
  db: SupabaseClient,
  projectId: string,
): Promise<Set<string>> {
  const paths = new Set<string>()
  for (let page = 0; page < MAX_PATH_PAGES; page++) {
    const from = page * PATH_PAGE
    const { data, error } = await db
      .from('project_codebase_files')
      .select('file_path')
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .order('id', { ascending: true })
      .range(from, from + PATH_PAGE - 1)
    if (error) throw new Error(`project_codebase_files path read failed: ${error.message}`)
    for (const row of data ?? []) {
      if (typeof row.file_path === 'string') paths.add(row.file_path)
    }
    if (!data || data.length < PATH_PAGE) return paths
  }
  // The last page was full, so the set may be missing live files. An empty
  // set tells pruneGraphToLivePaths to keep the graph.
  return new Set()
}

export function isGraphWriteBusy(error: DbError): boolean {
  if (!error) return false
  return error.code === '55P03' || (error.message ?? '').includes('graph_write_busy')
}

export function isStatementTimeout(error: DbError): boolean {
  if (!error) return false
  if (error.code === '57014') return true
  return (error.message ?? '').toLowerCase().includes('statement timeout')
}

/**
 * Upsert the graph. One retry on 57014 (the other writer may have finished).
 * `busy` means the per-project advisory lock was held; do not retry here.
 */
export async function writeCodebaseGraph(
  db: SupabaseClient,
  args: {
    projectId: string
    indexFingerprint: string
    commitSha: string | null
    graph: KnowledgeGraph
  },
): Promise<{ ok: true } | { ok: false; busy: boolean; message: string }> {
  let lastMessage = 'project_codebase_graph write failed'
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const { error } = await db.rpc('write_codebase_graph', {
      p_project_id: args.projectId,
      p_index_fingerprint: args.indexFingerprint,
      p_commit_sha: args.commitSha,
      p_graph: args.graph,
    })
    if (!error) return { ok: true }
    lastMessage = error.message ?? lastMessage
    if (isGraphWriteBusy(error)) return { ok: false, busy: true, message: lastMessage }
    if (!isStatementTimeout(error)) return { ok: false, busy: false, message: lastMessage }
  }
  return { ok: false, busy: false, message: lastMessage }
}
