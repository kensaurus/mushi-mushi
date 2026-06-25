/**
 * MCP-equivalent triage context for classify-report Stage 2.
 * Mirrors the tools exposed by packages/mcp (get_similar_bugs, get_knowledge_graph)
 * so automatic triage uses the same comprehension layer as Cursor/CLI — not a
 * separate DB-only path. Each invocation logs `mcp.tool.called` for observability.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { findSimilarReports, type SimilarReport } from './embeddings.ts'
import { log } from './logger.ts'

export type McpToolCallRecord = {
  toolName: string
  reportId: string
  latencyMs: number
  ok: boolean
  resultCount?: number
  error?: string
}

export interface McpTriageContext {
  similarBugs: SimilarReport[]
  graphNodes: Array<{ id: string; node_type: string; label: string }>
  graphEdges: Array<{ source_node_id: string; target_node_id: string; edge_type: string }>
  toolCalls: McpToolCallRecord[]
}

function logMcpToolCall(record: McpToolCallRecord): void {
  log.info('mcp.tool.called', record)
}

async function invokeSimilarBugs(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
): Promise<{ similar: SimilarReport[]; record: McpToolCallRecord }> {
  const started = Date.now()
  try {
    const similar = await findSimilarReports(reportId, projectId, 0.65, 5)
    const record: McpToolCallRecord = {
      toolName: 'get_similar_bugs',
      reportId,
      latencyMs: Date.now() - started,
      ok: true,
      resultCount: similar.length,
    }
    logMcpToolCall(record)
    return { similar, record }
  } catch (err) {
    const record: McpToolCallRecord = {
      toolName: 'get_similar_bugs',
      reportId,
      latencyMs: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    logMcpToolCall(record)
    return { similar: [], record }
  }
}

async function invokeKnowledgeGraph(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  seed: string | null | undefined,
): Promise<{
  nodes: Array<{ id: string; node_type: string; label: string }>
  edges: Array<{ source_node_id: string; target_node_id: string; edge_type: string }>
  record: McpToolCallRecord
}> {
  const started = Date.now()
  if (!seed || seed.trim().length === 0) {
    const record: McpToolCallRecord = {
      toolName: 'get_knowledge_graph',
      reportId,
      latencyMs: Date.now() - started,
      ok: true,
      resultCount: 0,
    }
    logMcpToolCall(record)
    return { nodes: [], edges: [], record }
  }

  try {
    const cleanSeed = seed.trim().slice(0, 120).replace(/%/g, '')
    const { data: seedNode } = await db
      .from('graph_nodes')
      .select('id, node_type, label')
      .eq('project_id', projectId)
      .ilike('label', `%${cleanSeed}%`)
      .limit(1)
      .maybeSingle()

    if (!seedNode) {
      const record: McpToolCallRecord = {
        toolName: 'get_knowledge_graph',
        reportId,
        latencyMs: Date.now() - started,
        ok: true,
        resultCount: 0,
      }
      logMcpToolCall(record)
      return { nodes: [], edges: [], record }
    }

    const visited = new Map<string, { id: string; node_type: string; label: string }>()
    visited.set(seedNode.id, seedNode)
    const edges: Array<{ source_node_id: string; target_node_id: string; edge_type: string }> = []
    let frontier = [seedNode.id]
    const depth = 2

    for (let d = 0; d < depth && frontier.length && visited.size < 100; d++) {
      const { data: nextEdges } = await db
        .from('graph_edges')
        .select('source_node_id, target_node_id, edge_type')
        .eq('project_id', projectId)
        .or(`source_node_id.in.(${frontier.join(',')}),target_node_id.in.(${frontier.join(',')})`)
        .limit(100)

      const nextIds = new Set<string>()
      for (const e of nextEdges ?? []) {
        edges.push(e)
        if (!visited.has(e.source_node_id)) nextIds.add(e.source_node_id)
        if (!visited.has(e.target_node_id)) nextIds.add(e.target_node_id)
      }
      if (nextIds.size === 0) break

      const { data: nextNodes } = await db
        .from('graph_nodes')
        .select('id, node_type, label')
        .in('id', [...nextIds])
        .limit(100)

      frontier = []
      for (const n of nextNodes ?? []) {
        if (!visited.has(n.id)) {
          visited.set(n.id, n)
          frontier.push(n.id)
        }
      }
    }

    const record: McpToolCallRecord = {
      toolName: 'get_knowledge_graph',
      reportId,
      latencyMs: Date.now() - started,
      ok: true,
      resultCount: visited.size,
    }
    logMcpToolCall(record)
    return { nodes: [...visited.values()], edges, record }
  } catch (err) {
    const record: McpToolCallRecord = {
      toolName: 'get_knowledge_graph',
      reportId,
      latencyMs: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    logMcpToolCall(record)
    return { nodes: [], edges: [], record }
  }
}

/**
 * Gather MCP-equivalent triage context before Stage-2 LLM classification.
 */
export async function gatherMcpTriageContext(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  hints: { component?: string | null; route?: string | null; summary?: string | null },
): Promise<McpTriageContext> {
  const toolCalls: McpToolCallRecord[] = []

  const { similar, record: similarRecord } = await invokeSimilarBugs(db, projectId, reportId)
  toolCalls.push(similarRecord)

  const graphSeed = hints.component ?? hints.route ?? hints.summary?.slice(0, 80) ?? null
  const { nodes, edges, record: graphRecord } = await invokeKnowledgeGraph(
    db,
    projectId,
    reportId,
    graphSeed,
  )
  toolCalls.push(graphRecord)

  return {
    similarBugs: similar,
    graphNodes: nodes,
    graphEdges: edges,
    toolCalls,
  }
}

export function formatMcpTriageContextForPrompt(ctx: McpTriageContext): string {
  const sections: string[] = []

  if (ctx.similarBugs.length > 0) {
    const lines = ctx.similarBugs.map(
      (s) =>
        `- [${s.similarity.toFixed(2)}] ${s.reportId.slice(0, 8)}… ${s.category}: ${s.description.slice(0, 120)}`,
    )
    sections.push(`## Similar bugs (MCP get_similar_bugs)\n${lines.join('\n')}`)
  }

  if (ctx.graphNodes.length > 0) {
    const nodeLines = ctx.graphNodes
      .slice(0, 15)
      .map((n) => `- ${n.node_type}: ${n.label}`)
    sections.push(`## Knowledge graph neighborhood (MCP get_knowledge_graph)\n${nodeLines.join('\n')}`)
  }

  return sections.length > 0 ? `\n${sections.join('\n\n')}` : ''
}
