import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type NodeType = 'report_group' | 'component' | 'page' | 'version'
export type EdgeType = 'causes' | 'related_to' | 'regression_of' | 'duplicate_of' | 'affects' | 'fix_attempted' | 'fix_applied' | 'fix_verified'

export async function findOrCreateNode(
  db: SupabaseClient,
  projectId: string,
  nodeType: NodeType,
  label: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const { data: existing } = await db
    .from('graph_nodes')
    .select('id')
    .eq('project_id', projectId)
    .eq('node_type', nodeType)
    .eq('label', label)
    .single()

  if (existing) return existing.id

  const { data: created, error } = await db
    .from('graph_nodes')
    .insert({ project_id: projectId, node_type: nodeType, label, metadata })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create graph node: ${error.message}`)
  return created!.id
}

export async function createEdge(
  db: SupabaseClient,
  projectId: string,
  sourceNodeId: string,
  targetNodeId: string,
  edgeType: EdgeType,
  weight = 1.0,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const { data: existing } = await db
    .from('graph_edges')
    .select('id')
    .eq('source_node_id', sourceNodeId)
    .eq('target_node_id', targetNodeId)
    .eq('edge_type', edgeType)
    .single()

  if (existing) {
    await db.from('graph_edges').update({ weight, metadata }).eq('id', existing.id)
    return existing.id
  }

  const { data, error } = await db
    .from('graph_edges')
    .insert({ project_id: projectId, source_node_id: sourceNodeId, target_node_id: targetNodeId, edge_type: edgeType, weight, metadata })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create graph edge: ${error.message}`)
  return data!.id
}

export async function getBlastRadius(
  db: SupabaseClient,
  nodeId: string,
): Promise<Array<{ target_node_id: string; node_type: string; label: string; min_depth: number }>> {
  const { data } = await db.rpc('get_blast_radius', { p_node_id: nodeId })
  return data ?? []
}

export async function getNodeEdges(
  db: SupabaseClient,
  nodeId: string,
  direction: 'outgoing' | 'incoming' | 'both' = 'both',
): Promise<Array<{ id: string; edge_type: string; source_node_id: string; target_node_id: string; weight: number }>> {
  let query = db.from('graph_edges').select('id, edge_type, source_node_id, target_node_id, weight')

  if (direction === 'outgoing') {
    query = query.eq('source_node_id', nodeId)
  } else if (direction === 'incoming') {
    query = query.eq('target_node_id', nodeId)
  } else {
    query = query.or(`source_node_id.eq.${nodeId},target_node_id.eq.${nodeId}`)
  }

  const { data } = await query.limit(100)
  return data ?? []
}

export async function buildReportGraph(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  component?: string,
  pageUrl?: string,
  groupId?: string,
): Promise<void> {
  const nodes: string[] = []

  if (groupId) {
    const groupNodeId = await findOrCreateNode(db, projectId, 'report_group', groupId, { reportId })
    nodes.push(groupNodeId)
  }

  if (component) {
    const compNodeId = await findOrCreateNode(db, projectId, 'component', component)
    if (nodes.length > 0) {
      await createEdge(db, projectId, nodes[0], compNodeId, 'affects')
    }
    nodes.push(compNodeId)
  }

  if (pageUrl) {
    const pagePath = new URL(pageUrl, 'https://placeholder').pathname
    const pageNodeId = await findOrCreateNode(db, projectId, 'page', pagePath)
    if (nodes.length > 0) {
      await createEdge(db, projectId, nodes[0], pageNodeId, 'affects')
    }
  }
}

export async function detectRegression(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  embeddingText: string,
): Promise<{ isRegression: boolean; originalGroupId?: string; originalReportId?: string }> {
  const { createEmbedding } = await import('./embeddings.ts')
  const embedding = await createEmbedding(embeddingText)

  const { data: matches } = await db.rpc('match_report_embeddings', {
    query_embedding: embedding,
    match_project: projectId,
    match_count: 5,
    match_threshold: 0.85,
  })

  if (!matches?.length) return { isRegression: false }

  for (const match of matches) {
    if (match.report_id === reportId) continue

    const { data: report } = await db
      .from('reports')
      .select('id, status, report_group_id')
      .eq('id', match.report_id)
      .single()

    if (report?.status === 'fixed' && report.report_group_id) {
      await db.from('reports').update({ regressed_at: new Date().toISOString() }).eq('id', reportId)

      return {
        isRegression: true,
        originalGroupId: report.report_group_id,
        originalReportId: report.id,
      }
    }
  }

  return { isRegression: false }
}
