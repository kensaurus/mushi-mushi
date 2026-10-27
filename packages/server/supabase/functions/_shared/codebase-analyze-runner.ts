/**
 * Codebase graph analyze job runner — builds UA-shaped graph JSON from
 * project_codebase_files. Inspired by Understand-Anything (MIT).
 *
 * The graph is one jsonb row. Writes go through write_codebase_graph
 * (90s timeout, per-project advisory lock, lz4). A second job for the same
 * project is put back on the queue instead of waiting out statement_timeout.
 *
 * The index is read page by page: PostgREST's max_rows (1000) truncated the
 * single `.limit(10000)` read, so the graph was rebuilt from a slice and the
 * merge put the rest of the stored document back — the jsonb row only grew.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getIndexFingerprint, loadExploreGraph } from './codebase-understand.ts'
import { invalidateCodebaseUnderstandCaches } from './codebase-impact-resolve.ts'
import { buildGraphFromIndex, fingerprintFile, mergeGraphUpdate } from './codebase-graph-build.ts'
import {
  listIndexedFilePaths,
  listIndexedFileRows,
  pruneGraphToLivePaths,
  writeCodebaseGraph,
} from './codebase-graph-write.ts'
import { log } from './logger.ts'
import { runWikiIngestForProject } from './wiki-ingest.ts'

const runnerLog = log.child('codebase-analyze-runner')

export interface AnalyzeJobResult {
  ok: boolean
  status: 'completed' | 'failed' | 'skipped'
  error?: string
  pathsAnalyzed?: number
}

/**
 * A job still 'running' after this long lost its worker (the edge wall clock
 * is 150-400 s), so the drain puts it back in the queue.
 */
const ANALYZE_JOB_STALE_MS = 15 * 60 * 1000
/** Jobs one drain call starts at most, and the cap a caller may ask for. */
const ANALYZE_DRAIN_DEFAULT_LIMIT = 5
const ANALYZE_DRAIN_MAX_LIMIT = 20
/** A drain stops starting new jobs after this long, inside the edge wall clock. */
const ANALYZE_DRAIN_BUDGET_MS = 100 * 1000
/**
 * A sibling still 'running' from before this is a dead worker, not a live
 * graph write. The stale reaper uses a longer window; blocking on it would
 * freeze the project until that reaper runs.
 */
const ANALYZE_SIBLING_ACTIVE_MS = 8 * 60 * 1000
/** Rows per project_codebase_fingerprints upsert, under the 8s timeout. */
const FINGERPRINT_BATCH = 500
/** Rows per stored-fingerprint read page; PostgREST's max_rows is 1000. */
const FINGERPRINT_PAGE = 1000
/** 50k rows, matching the index walk. A full last page means a truncated read. */
const MAX_FINGERPRINT_PAGES = 50

/**
 * The stored fingerprint of every file, keyed by path, or null when the read
 * failed or ran out of pages — then the caller writes them all, as before.
 *
 * Keyset on file_path like the index walk, so no page re-sorts the project.
 */
async function listStoredFingerprints(
  db: SupabaseClient,
  projectId: string,
): Promise<Map<string, string> | null> {
  const stored = new Map<string, string>()
  let after: string | null = null
  for (let page = 0; page < MAX_FINGERPRINT_PAGES; page++) {
    let query = db
      .from('project_codebase_fingerprints')
      .select('file_path, fingerprint')
      .eq('project_id', projectId)
    if (after !== null) query = query.gt('file_path', after)
    const { data, error } = await query.order('file_path', { ascending: true }).limit(FINGERPRINT_PAGE)
    if (error) return null
    const rows = data ?? []
    for (const row of rows) stored.set(String(row.file_path), fingerprintDigest(row.fingerprint))
    if (rows.length < FINGERPRINT_PAGE) return stored
    after = String(rows[rows.length - 1].file_path)
  }
  return null
}

/**
 * Compare two fingerprints by value. jsonb does not keep key order, so the
 * stored object and a fresh one do not stringify the same way.
 */
function fingerprintDigest(fp: unknown): string {
  const f = (fp ?? {}) as { contentHash?: unknown; exportCount?: unknown; importCount?: unknown }
  return `${String(f.contentHash ?? '')}|${String(f.exportCount ?? '')}|${String(f.importCount ?? '')}`
}

/** Put a claimed job back on the queue. Only touches a row this worker still owns. */
async function releaseAnalyzeJob(db: SupabaseClient, jobId: string, error: string): Promise<void> {
  await db
    .from('codebase_analyze_jobs')
    .update({
      status: 'queued',
      started_at: null,
      error: error.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'running')
}

async function finishAnalyzeJob(
  db: SupabaseClient,
  jobId: string,
  plan: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .from('codebase_analyze_jobs')
    .update({ status: 'completed', error: null, finished_at: now, updated_at: now, plan })
    .eq('id', jobId)
}

export async function runCodebaseAnalyzeJob(
  db: SupabaseClient,
  jobId: string,
): Promise<AnalyzeJobResult> {
  // Claim and read in one conditional update: two callers (a push kick and
  // the cron drain) can reach the same job, and only the one whose update
  // matched status = 'queued' runs it.
  const claimedAt = new Date().toISOString()
  const { data: job, error: claimErr } = await db
    .from('codebase_analyze_jobs')
    .update({ status: 'running', started_at: claimedAt, updated_at: claimedAt })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('id, project_id, status, trigger, changed_paths')
    .maybeSingle()

  if (claimErr) {
    return { ok: false, status: 'failed', error: `claim failed: ${claimErr.message}` }
  }
  if (!job) {
    const { data: existing, error: readErr } = await db
      .from('codebase_analyze_jobs')
      .select('status')
      .eq('id', jobId)
      .maybeSingle()
    if (readErr || !existing) {
      return { ok: false, status: 'failed', error: readErr?.message ?? 'job not found' }
    }
    return { ok: true, status: 'skipped', error: `job status ${existing.status}` }
  }

  try {
    const projectId = job.project_id as string

    // Knowledge sources are docs, not code: they get their own ingest and
    // must not rebuild the code graph.
    if (job.trigger === 'wiki_ingest') {
      const wiki = await runWikiIngestForProject(db, projectId)
      await db
        .from('codebase_analyze_jobs')
        .update({
          status: 'completed',
          error: null,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          plan: { wiki_sources: wiki.processed, ready: wiki.ready, failed: wiki.failed },
        })
        .eq('id', jobId)
      return { ok: true, status: 'completed', pathsAnalyzed: wiki.processed }
    }

    // One graph writer per project. A second job waits on the jsonb row and
    // the wait counts toward statement_timeout (Sentry 7786063319).
    const siblingSince = new Date(Date.now() - ANALYZE_SIBLING_ACTIVE_MS).toISOString()
    const { data: sibling, error: siblingErr } = await db
      .from('codebase_analyze_jobs')
      .select('id')
      .eq('project_id', projectId)
      .eq('status', 'running')
      .neq('id', jobId)
      .neq('trigger', 'wiki_ingest')
      .gt('started_at', siblingSince)
      .limit(1)
      .maybeSingle()
    if (siblingErr) throw new Error(`codebase_analyze_jobs read failed: ${siblingErr.message}`)
    if (sibling) {
      await releaseAnalyzeJob(db, jobId, 'Requeued: another analyze job is running for this project.')
      return { ok: true, status: 'skipped', error: 'another analyze job is running for this project' }
    }

    const fingerprint = await getIndexFingerprint(db, projectId)
    const { data: graphMeta, error: graphMetaErr } = await db
      .from('project_codebase_graph')
      .select('index_fingerprint')
      .eq('project_id', projectId)
      .maybeSingle()
    if (graphMetaErr) throw new Error(`project_codebase_graph read failed: ${graphMetaErr.message}`)
    if (graphMeta?.index_fingerprint === fingerprint) {
      await finishAnalyzeJob(db, jobId, { unchanged: true })
      return { ok: true, status: 'completed', pathsAnalyzed: 0 }
    }

    const { data: project } = await db.from('projects').select('name').eq('id', projectId).maybeSingle()
    // Every read below is checked: a failed read used to build an empty
    // graph and mark the job completed.
    const { data: repo, error: repoErr } = await db
      .from('project_repos')
      .select('commit_sha')
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .maybeSingle()
    if (repoErr) throw new Error(`project_repos read failed: ${repoErr.message}`)

    // Paged: one `.limit(10000)` was capped at PostgREST's max_rows (1000),
    // so the graph was rebuilt from a slice and the merge put the rest back.
    const index = await listIndexedFileRows(db, projectId)
    const allRows = index.rows
    const fileRows = allRows.filter((r) => !r.symbol_name)
    const symbolRows = allRows.filter((r) => r.symbol_name)

    const changedPaths = (job.changed_paths as string[] | null) ?? []
    const nextGraph = buildGraphFromIndex({
      projectName: project?.name ?? 'project',
      commitSha: repo?.commit_sha ?? null,
      fileRows,
      symbolRows,
    })

    // A whole-index rebuild is the whole graph. Reading the stored document
    // back would only re-add nodes the index no longer has — and it is the
    // multi-megabyte jsonb row this job is about to rewrite. buildGraphFromIndex
    // is the only producer of those nodes: write_codebase_graph is the only
    // writer of the row and this runner is its only caller, so a rebuild that
    // drops stored nodes without a filePath drops nothing but stale ones.
    let existingGraph: ReturnType<typeof buildGraphFromIndex> | null = null
    if (changedPaths.length > 0 || !index.complete) {
      const { data: existingGraphRow, error: graphReadErr } = await db
        .from('project_codebase_graph')
        .select('graph')
        .eq('project_id', projectId)
        .maybeSingle()
      if (graphReadErr) throw new Error(`project_codebase_graph read failed: ${graphReadErr.message}`)
      existingGraph = (existingGraphRow?.graph as ReturnType<typeof buildGraphFromIndex> | null) ?? null
    }

    const merged = mergeGraphUpdate(
      existingGraph,
      nextGraph,
      changedPaths.length ? changedPaths : fileRows.map((r) => r.file_path),
    )
    // Drop nodes for tombstoned or deleted files. The merge keeps every path
    // it is not given, so a push that only admits written files used to
    // accumulate ghosts until the jsonb upsert timed out.
    const livePaths = await listIndexedFilePaths(db, projectId)
    const pruned = pruneGraphToLivePaths(merged, livePaths)

    // RPC: 90s timeout, lz4 toast, advisory lock. A busy lock is requeued;
    // a statement timeout is retried once inside writeCodebaseGraph.
    // See migrations 20261014120000 and 20261020123834.
    const written = await writeCodebaseGraph(db, {
      projectId,
      indexFingerprint: fingerprint,
      commitSha: repo?.commit_sha ?? null,
      graph: pruned,
    })
    if (!written.ok && written.busy) {
      await releaseAnalyzeJob(db, jobId, 'Requeued: another graph write holds this project.')
      return { ok: true, status: 'skipped', error: 'graph write busy' }
    }
    if (!written.ok) throw new Error(`project_codebase_graph write failed: ${written.message}`)

    // Only the files whose fingerprint can have moved. A push names them, so
    // no other file's index row changed; a full rebuild diffs against the
    // stored rows. Writing all ~26k every run cost 50+ sequential round trips
    // inside the drain budget to rewrite rows that were already current.
    const changed = new Set(changedPaths)
    const fpCandidates = changedPaths.length ? fileRows.filter((r) => changed.has(r.file_path)) : fileRows
    const storedFps = changedPaths.length ? null : await listStoredFingerprints(db, projectId)
    const fpRows = fpCandidates
      .map((r) => ({
        project_id: projectId,
        file_path: r.file_path,
        fingerprint: fingerprintFile(r),
        updated_at: new Date().toISOString(),
      }))
      .filter((row) => !storedFps || storedFps.get(row.file_path) !== fingerprintDigest(row.fingerprint))
    // Batched: the index read is no longer capped at 1000 rows, and one
    // upsert of every fingerprint would run past the 8s statement timeout.
    // A failed batch is logged, not thrown: the graph is already written and
    // a stale fingerprint only costs the next push a re-chunk of that file.
    for (let i = 0; i < fpRows.length; i += FINGERPRINT_BATCH) {
      const { error: fpErr } = await db
        .from('project_codebase_fingerprints')
        .upsert(fpRows.slice(i, i + FINGERPRINT_BATCH), { onConflict: 'project_id,file_path' })
      if (fpErr) {
        runnerLog.warn('project_codebase_fingerprints batch upsert failed', {
          jobId,
          projectId,
          batchStart: i,
          batchSize: Math.min(FINGERPRINT_BATCH, fpRows.length - i),
          err: fpErr.message,
        })
      }
    }

    await invalidateCodebaseUnderstandCaches(db, projectId)
    await finishAnalyzeJob(db, jobId, { node_count: pruned.nodes.length, edge_count: pruned.edges.length })

    return { ok: true, status: 'completed', pathsAnalyzed: changedPaths.length || fileRows.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    runnerLog.error('analyze job failed', { jobId, err: msg })
    await db
      .from('codebase_analyze_jobs')
      .update({
        status: 'failed',
        error: msg.slice(0, 500),
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    return { ok: false, status: 'failed', error: msg }
  }
}

/** Clamp a caller's `limit` to 1..20; anything unusable means the default. */
export function analyzeDrainLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n < 1) return ANALYZE_DRAIN_DEFAULT_LIMIT
  return Math.min(Math.floor(n), ANALYZE_DRAIN_MAX_LIMIT)
}

/**
 * Put jobs whose worker died (still 'running' after ANALYZE_JOB_STALE_MS)
 * back in the queue. A job that times out on every attempt is requeued every
 * time; there is no attempt counter yet.
 */
async function requeueStaleAnalyzeJobs(
  db: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{ requeued: number; error?: string }> {
  const cutoff = new Date(nowMs - ANALYZE_JOB_STALE_MS).toISOString()
  const { data, error } = await db
    .from('codebase_analyze_jobs')
    .update({
      status: 'queued',
      started_at: null,
      updated_at: new Date(nowMs).toISOString(),
      error: `Requeued: still running after ${ANALYZE_JOB_STALE_MS / 60000} minutes (the worker stopped).`,
    })
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .select('id')
  if (error) return { requeued: 0, error: error.message }
  return { requeued: data?.length ?? 0 }
}

interface AnalyzeDrainSummary {
  requeued: number
  picked: number
  results: Array<{ jobId: string; status: AnalyzeJobResult['status']; error?: string }>
  error?: string
}

/**
 * Drain the queue: requeue stale jobs, then run the oldest queued jobs one at
 * a time. Each run claims its job with a conditional update, so a concurrent
 * kick or a second drain never runs the same job twice. Stops starting jobs
 * after ANALYZE_DRAIN_BUDGET_MS so the call ends inside the edge wall clock.
 */
export async function drainCodebaseAnalyzeJobs(
  db: SupabaseClient,
  opts: { limit?: number; now?: () => number } = {},
): Promise<AnalyzeDrainSummary> {
  const now = opts.now ?? Date.now
  const startedAt = now()
  const limit = analyzeDrainLimit(opts.limit)
  const stale = await requeueStaleAnalyzeJobs(db, startedAt)
  if (stale.error) runnerLog.warn('stale analyze job requeue failed', { err: stale.error })

  const { data: queued, error: pickErr } = await db
    .from('codebase_analyze_jobs')
    .select('id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (pickErr) {
    return { requeued: stale.requeued, picked: 0, results: [], error: `queue read failed: ${pickErr.message}` }
  }

  const results: AnalyzeDrainSummary['results'] = []
  for (const row of queued ?? []) {
    if (now() - startedAt > ANALYZE_DRAIN_BUDGET_MS) break
    const jobId = row.id as string
    const result = await runCodebaseAnalyzeJob(db, jobId)
    results.push({ jobId, status: result.status, ...(result.error ? { error: result.error } : {}) })
  }
  return { requeued: stale.requeued, picked: queued?.length ?? 0, results }
}

export async function enqueueCodebaseAnalyzeJob(
  db: SupabaseClient,
  args: {
    projectId: string
    requestedBy?: string | null
    trigger: string
    changedPaths?: string[]
  },
): Promise<{ jobId: string }> {
  const { data, error } = await db
    .from('codebase_analyze_jobs')
    .insert({
      project_id: args.projectId,
      requested_by: args.requestedBy ?? null,
      trigger: args.trigger,
      changed_paths: args.changedPaths ?? null,
      status: 'queued',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'failed to enqueue analyze job')
  return { jobId: data.id as string }
}
