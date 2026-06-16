/**
 * Codebase graph analyze job runner — builds UA-shaped graph JSON from
 * project_codebase_files. Inspired by Understand-Anything (MIT).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getIndexFingerprint, loadExploreGraph } from './codebase-understand.ts'
import { invalidateCodebaseUnderstandCaches } from './codebase-impact-resolve.ts'
import { buildGraphFromIndex, fingerprintFile, mergeGraphUpdate } from './codebase-graph-build.ts'
import { log } from './logger.ts'

const runnerLog = log.child('codebase-analyze-runner')

export interface AnalyzeJobResult {
  ok: boolean
  status: 'completed' | 'failed' | 'skipped'
  error?: string
  pathsAnalyzed?: number
}

export async function runCodebaseAnalyzeJob(
  db: SupabaseClient,
  jobId: string,
): Promise<AnalyzeJobResult> {
  const { data: job, error: jobErr } = await db
    .from('codebase_analyze_jobs')
    .select('id, project_id, status, trigger, changed_paths')
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr || !job) {
    return { ok: false, status: 'failed', error: jobErr?.message ?? 'job not found' }
  }
  if (job.status !== 'queued') {
    return { ok: true, status: 'skipped', error: `job status ${job.status}` }
  }

  await db
    .from('codebase_analyze_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', jobId)

  try {
    const projectId = job.project_id as string
    const fingerprint = await getIndexFingerprint(db, projectId)

    const { data: project } = await db.from('projects').select('name').eq('id', projectId).maybeSingle()
    const { data: repo } = await db
      .from('project_repos')
      .select('commit_sha')
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .maybeSingle()

    const { data: rows } = await db
      .from('project_codebase_files')
      .select('id, file_path, symbol_name, signature, line_start, line_end, language, content_preview, content_hash')
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .limit(10000)

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

    const { data: existingGraphRow } = await db
      .from('project_codebase_graph')
      .select('graph')
      .eq('project_id', projectId)
      .maybeSingle()

    const merged = mergeGraphUpdate(
      (existingGraphRow?.graph as ReturnType<typeof buildGraphFromIndex> | null) ?? null,
      nextGraph,
      changedPaths.length ? changedPaths : fileRows.map((r) => r.file_path),
    )

    await db.from('project_codebase_graph').upsert(
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
