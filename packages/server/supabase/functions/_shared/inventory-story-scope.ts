import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

/**
 * Collect action graph_node UUIDs reachable from a user_story (or any
 * inventory subtree root) via `contains` + `triggers` edges.
 */
export async function collectDescendantActionIds(
  db: SupabaseClient,
  projectId: string,
  rootNodeId: string,
): Promise<Set<string>> {
  const actionIds = new Set<string>()
  const visited = new Set<string>()
  const queue = [rootNodeId]

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    const { data: node } = await db
      .from('graph_nodes')
      .select('node_type')
      .eq('project_id', projectId)
      .eq('id', nodeId)
      .maybeSingle()

    if (node?.node_type === 'action') {
      actionIds.add(nodeId)
      continue
    }

    const { data: edges } = await db
      .from('graph_edges')
      .select('target_node_id')
      .eq('project_id', projectId)
      .eq('source_node_id', nodeId)
      .in('edge_type', ['contains', 'triggers'])

    for (const e of edges ?? []) {
      const target = e.target_node_id as string | null
      if (target) queue.push(target)
    }
  }

  return actionIds
}

/** Resolve a user_story graph node UUID to its inventory.yaml external id (label). */
export async function resolveStoryExternalId(
  db: SupabaseClient,
  projectId: string,
  storyNodeId: string,
): Promise<string | null> {
  const { data } = await db
    .from('graph_nodes')
    .select('label, node_type')
    .eq('project_id', projectId)
    .eq('id', storyNodeId)
    .maybeSingle()

  if (!data || data.node_type !== 'user_story') return null
  return (data.label as string) ?? null
}
