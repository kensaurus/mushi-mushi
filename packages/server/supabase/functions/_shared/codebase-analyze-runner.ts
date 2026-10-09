/**
 * Codebase graph analyze job runner — builds UA-shaped graph JSON from
 * project_codebase_files. Inspired by Understand-Anything (MIT).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getIndexFingerprint, loadExploreGraph } from './codebase-understand.ts'
import { invalidateCodebaseUnderstandCaches } from './codebase-impact-resolve.ts'
import { buildGraphFromIndex, fingerprintFile, mergeGraphUpdate } from './codebase-graph-build.ts'
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

    const fingerprint = await getIndexFingerprint(db, projectId)

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

    const { data: rows, error: rowsErr } = await db
      .from('project_codebase_files')
      .select('id, file_path, symbol_name, signature, line_start, line_end, language, content_preview, content_hash, imports')
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .limit(10000)
    if (rowsErr) throw new Error(`project_codebase_files read failed: ${rowsErr.message}`)

    const allRows = rows ?? []
    const fileRows = allRows.filter((r) => !r.symbol_name)
    const symbolRows = allRows.filter((r) => r.symbol_name)

    const changedPaths = (job.changed_paths as string[] | null) ?? []
    const nextGraph = buildGraphFromIndex({
      projectName: project?.name ?? 'project',
      commitSha: repo?.commit_sha ?? null,
      fileRows,
      symbolRows,
    })

    const { data: existingGraphRow, error: graphReadErr } = await db
      .from('project_codebase_graph')
      .select('graph')
      .eq('project_id', projectId)
      .maybeSingle()
    if (graphReadErr) throw new Error(`project_codebase_graph read failed: ${graphReadErr.message}`)

    const merged = mergeGraphUpdate(
      (existingGraphRow?.graph as ReturnType<typeof buildGraphFromIndex> | null) ?? null,
      nextGraph,
      changedPaths.length ? changedPaths : fileRows.map((r) => r.file_path),
    )

    const { error: graphWriteErr } = await db.from('project_codebase_graph').upsert(
      {
        project_id: projectId,
        index_fingerprint: fingerprint,
        commit_sha: repo?.commit_sha ?? null,
        graph: merged,
        graph_version: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' },
    )
    if (graphWriteErr) throw new Error(`project_codebase_graph write failed: ${graphWriteErr.message}`)

    const fpRows = fileRows.map((r) => ({
      project_id: projectId,
      file_path: r.file_path,
      fingerprint: fingerprintFile(r),
      updated_at: new Date().toISOString(),
    }))
    if (fpRows.length > 0) {
      await db.from('project_codebase_fingerprints').upsert(fpRows, {
        onConflict: 'project_id,file_path',
      })
    }

    await invalidateCodebaseUnderstandCaches(db, projectId)

    await db
      .from('codebase_analyze_jobs')
      .update({
        status: 'completed',
        error: null,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        plan: { node_count: merged.nodes.length, edge_count: merged.edges.length },
      })
      .eq('id', jobId)

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
