// =============================================================================
// V5.3 §2.17 Wave B B6 — Apache AGE parallel-write client.
//
// Phase 1 contract:
//   - SQL graph_nodes / graph_edges remain the source of truth.
//   - When a project's `graph_backend` is `sql_age_parallel`, we mirror every
//     write into AGE *immediately after* the SQL commit. Failures here are
//     never fatal; they get logged and surface as drift on the next audit.
//   - When `sql_only` (default), AGE writes are skipped entirely — there is
//     zero overhead.
// =============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const ageLog = log.child('age-graph')

export type GraphBackend = 'sql_only' | 'sql_age_parallel' | 'age_only'

const backendCache = new Map<string, { backend: GraphBackend; cachedAt: number }>()
const CACHE_TTL_MS = 60_000

/** Look up the project's graph backend, with a short in-process cache. */
export async function getGraphBackend(
  db: SupabaseClient,
  projectId: string,
): Promise<GraphBackend> {
  const cached = backendCache.get(projectId)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.backend

  const { data, error } = await db
    .from('project_settings')
    .select('graph_backend')
    .eq('project_id', projectId)
    .maybeSingle()

  const backend: GraphBackend =
    error || !data?.graph_backend ? 'sql_only' : (data.graph_backend as GraphBackend)
  backendCache.set(projectId, { backend, cachedAt: Date.now() })
  return backend
}

/** Force a refresh next time `getGraphBackend` is called. */
export function invalidateBackendCache(projectId?: string): void {
  if (projectId) backendCache.delete(projectId)
  else backendCache.clear()
}

/**
 * Mirror a node into AGE if the project has opted in. Records the sync time
 * (or error) on the SQL row so drift is visible immediately. Never throws —
 * Phase 1 explicitly treats AGE as best-effort.
 */
export async function mirrorNodeToAge(
  db: SupabaseClient,
  args: {
    projectId: string
    nodeId: string
    nodeType: string
    label: string
  },
): Promise<{ mirrored: boolean; reason?: string }> {
  const backend = await getGraphBackend(db, args.projectId)
  if (backend === 'sql_only') return { mirrored: false, reason: 'sql_only' }

  const { data, error } = await db.rpc('mushi_age_upsert_node', {
    p_node_id: args.nodeId,
    p_project_id: args.projectId,
    p_node_type: args.nodeType,
    p_label: args.label,
  })

  if (error || data === false) {
    const reason = error?.message ?? 'age_unavailable_or_failed'
    ageLog.warn('Failed to mirror node to AGE', { nodeId: args.nodeId, reason })
    await db
      .from('graph_nodes')
      .update({ age_synced_at: null, age_sync_error: reason.slice(0, 500) })
      .eq('id', args.nodeId)
    return { mirrored: false, reason }
  }

  await db
    .from('graph_nodes')
    .update({ age_synced_at: new Date().toISOString(), age_sync_error: null })
    .eq('id', args.nodeId)
  return { mirrored: true }
}

export async function mirrorEdgeToAge(
  db: SupabaseClient,
  args: {
    projectId: string
    edgeId: string
    sourceNodeId: string
    targetNodeId: string
    edgeType: string
    weight: number
  },
): Promise<{ mirrored: boolean; reason?: string }> {
  const backend = await getGraphBackend(db, args.projectId)
  if (backend === 'sql_only') return { mirrored: false, reason: 'sql_only' }

  const { data, error } = await db.rpc('mushi_age_upsert_edge', {
    p_edge_id: args.edgeId,
    p_project_id: args.projectId,
    p_source_id: args.sourceNodeId,
    p_target_id: args.targetNodeId,
    p_edge_type: args.edgeType,
    p_weight: args.weight,
  })

  if (error || data === false) {
    const reason = error?.message ?? 'age_unavailable_or_failed'
    ageLog.warn('Failed to mirror edge to AGE', { edgeId: args.edgeId, reason })
    await db
      .from('graph_edges')
      .update({ age_synced_at: null, age_sync_error: reason.slice(0, 500) })
      .eq('id', args.edgeId)
    return { mirrored: false, reason }
  }

  await db
    .from('graph_edges')
    .update({ age_synced_at: new Date().toISOString(), age_sync_error: null })
    .eq('id', args.edgeId)
  return { mirrored: true }
}

/** Trigger a cheap row-count drift snapshot. Returns the audit row id. */
export async function snapshotDrift(
  db: SupabaseClient,
  projectId: string,
): Promise<{ auditId: string | null; error?: string }> {
  const { data, error } = await db.rpc('mushi_age_snapshot_drift', {
    p_project_id: projectId,
  })
  if (error) {
    ageLog.error('Drift snapshot failed', { projectId, err: error.message })
    return { auditId: null, error: error.message }
  }
  return { auditId: data as string | null }
}

/** Whether AGE is loaded in the database at all. */
export async function isAgeAvailable(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc('mushi_age_available')
  if (error) return false
  return data === true
}
