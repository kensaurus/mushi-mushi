/**
 * FILE: codebase-graph-write.ts
 * PURPOSE: Write project_codebase_graph without burning the statement timeout.
 *
 * OVERVIEW:
 * - The graph is one jsonb row. Two analyze jobs for one project used to
 *   block on that row until Postgres cancelled the statement (57014).
 * - Incremental merges kept nodes for files that had left the index, so the
 *   document only grew and the upsert got slower.
 * - The index read was truncated by PostgREST's max_rows (1000), so a
 *   "full" rebuild was a slice and the merge re-added everything else.
 *
 * DEPENDENCIES:
 * - Supabase client rpc `write_codebase_graph`
 * - KnowledgeGraph from codebase-graph-build.ts
 *
 * USAGE:
 * - codebase-analyze-runner.ts calls listIndexedFileRows, listIndexedFilePaths,
 *   pruneGraphToLivePaths, and writeCodebaseGraph around the graph upsert.
 *
 * NOTES:
 * - A statement timeout is retried once. A busy project lock is not: the
 *   caller requeues the job. A second full timeout can outlive the edge
 *   wall clock; the stale-job reaper picks that up.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { IndexedFileRow, KnowledgeGraph } from './codebase-graph-build.ts'

const PATH_PAGE = 1000
/** 100k rows. A full last page means the read was cut off — fail open. */
const MAX_PATH_PAGES = 100
const WRITE_ATTEMPTS = 2

/** The columns buildGraphFromIndex reads. */
const FILE_ROW_COLUMNS =
  'id, file_path, symbol_name, signature, line_start, line_end, language, content_preview, content_hash, imports'
/** PostgREST's max_rows is 1000 (supabase/config.toml), so a page can be no bigger. */
const FILE_ROW_PAGE = 1000
/**
 * 50k rows. Unlike the path walk these rows carry content_preview, so the
 * cap is what keeps the edge worker inside its memory limit; the largest
 * project indexes about 26k. Past it the caller merges the stored graph.
 */
const MAX_FILE_ROW_PAGES = 50

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

/**
 * Every non-tombstoned path, paged so PostgREST max_rows cannot truncate it.
 *
 * Keyset pages on file_path (`> last`), an index-only scan of
 * idx_codebase_files_active. The OFFSET pages ordered by id re-read and
 * re-sorted the project's rows for every page: page 26 of a 26k-chunk project
 * took 1.8 s (84k buffers) warm, the whole walk about 25 s of database time,
 * and cold it hit the 8 s statement timeout (MUSHI-MUSHI-SERVER-2Q). Keyset:
 * 9 ms a page. A page that ends inside a path's chunks loses nothing: the
 * path is already in the set.
 */
export async function listIndexedFilePaths(
  db: SupabaseClient,
  projectId: string,
): Promise<Set<string>> {
  const paths = new Set<string>()
  let after: string | null = null
  for (let page = 0; page < MAX_PATH_PAGES; page++) {
    let query = db
      .from('project_codebase_files')
      .select('file_path')
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
    if (after !== null) query = query.gt('file_path', after)
    const { data, error } = await query.order('file_path', { ascending: true }).limit(PATH_PAGE)
    if (error) throw new Error(`project_codebase_files path read failed: ${error.message}`)
    for (const row of data ?? []) {
      if (typeof row.file_path === 'string') paths.add(row.file_path)
    }
    if (!data || data.length < PATH_PAGE) return paths
    after = (data[data.length - 1] as { file_path: string }).file_path
  }
  // The last page was full, so the set may be missing live files. An empty
  // set tells pruneGraphToLivePaths to keep the graph.
  return new Set()
}

export interface IndexedFileRows {
  rows: IndexedFileRow[]
  /** False when the walk ran out of pages: the rows are not the whole index. */
  complete: boolean
}

/**
 * Every non-tombstoned index row of a project, paged.
 *
 * A single `.limit(10000)` returned 1000 rows — PostgREST's max_rows caps
 * every read (supabase/config.toml). The graph was therefore built from an
 * arbitrary 1000-row slice and mergeGraphUpdate put the rest of the stored
 * document back, so the jsonb row only ever grew until the upsert hit the
 * statement timeout (57014).
 *
 * Pages keyset on file_path over idx_codebase_files_active. A path's chunk
 * rows can straddle a page, so the next page re-reads that path (`gte`) and
 * ids dedupe the overlap. A page that is one single path cannot be re-read
 * without looping, so the walk pages inside that path on `id` until its rows
 * run out and only then steps past it: stepping past it straight away
 * dropped the rest of a file with more rows than a page.
 */
export async function listIndexedFileRows(
  db: SupabaseClient,
  projectId: string,
): Promise<IndexedFileRows> {
  const rows: IndexedFileRow[] = []
  const seen = new Set<string>()
  let after: string | null = null
  let inclusive = false
  /** Set while paging inside one path whose rows fill a whole page. */
  let afterId: string | null = null
  for (let page = 0; page < MAX_FILE_ROW_PAGES; page++) {
    let query = db
      .from('project_codebase_files')
      .select(FILE_ROW_COLUMNS)
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
    if (afterId !== null) {
      query = query.eq('file_path', after as string).gt('id', afterId).order('id', { ascending: true })
    } else {
      if (after !== null) query = inclusive ? query.gte('file_path', after) : query.gt('file_path', after)
      query = query.order('file_path', { ascending: true }).order('id', { ascending: true })
    }
    const { data, error } = await query.limit(FILE_ROW_PAGE)
    if (error) throw new Error(`project_codebase_files read failed: ${error.message}`)
    const batch = (data ?? []) as unknown as IndexedFileRow[]
    for (const row of batch) {
      const id = String(row.id)
      if (seen.has(id)) continue
      seen.add(id)
      rows.push(row)
    }
    if (batch.length < FILE_ROW_PAGE) {
      // Inside a path: its rows are done, so carry on past it. Otherwise the
      // whole index is read.
      if (afterId === null) return { rows, complete: true }
      afterId = null
      inclusive = false
      continue
    }
    const first = String(batch[0].file_path)
    const last = String(batch[batch.length - 1].file_path)
    if (first === last) {
      after = last
      afterId = String(batch[batch.length - 1].id)
      continue
    }
    inclusive = true
    afterId = null
    after = last
  }
  return { rows, complete: false }
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
