/**
 * _shared/graph-nl.ts — Wave E §3d
 *
 * Pattern-detects graph-traversal questions in natural-language admin
 * queries (the /v1/admin/query endpoint and the QueryPage UI) and answers
 * them with a recursive CTE against `graph_nodes` + `graph_edges` instead
 * of asking the LLM to hand-write SQL it tends to get wrong.
 *
 * Detected intents:
 *   - blast_radius:  "what's the blast radius of <label>"
 *                    "what does <label> affect"
 *   - dependents:    "who depends on <label>"
 *                    "what depends on <label>"
 *   - dependencies:  "what does <label> depend on"
 *                    "dependencies of <label>"
 *   - path:          "path from <a> to <b>"
 *                    "shortest path from <a> to <b>"
 *
 * Returns null when no intent matches; nl-query then falls back to the
 * LLM SQL generator.
 *
 * Why CTEs and not the cached `get_blast_radius` function: the cache only
 * covers blast-radius. Dependents/path/dependencies need ad-hoc traversal
 * with depth limits, and using a single shared CTE shape keeps the latency
 * profile predictable (always project-scoped, always depth-bounded).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('graph-nl')

const MAX_DEPTH = 6
const MAX_RESULTS = 100

export type GraphIntent = 'blast_radius' | 'dependents' | 'dependencies' | 'path'

export interface GraphQueryDetection {
  intent: GraphIntent
  /** Primary label to look up in graph_nodes. */
  label: string
  /** Only set when intent === 'path'. */
  toLabel?: string
  /** Optional depth override (BFS hop limit). */
  maxDepth?: number
}

const PATTERNS: Array<{ rx: RegExp; build: (m: RegExpExecArray) => GraphQueryDetection }> = [
  {
    rx: /(?:what(?:'s| is)?|find)\s+the?\s*blast\s*radius\s+(?:of|for)\s+([\w./@:-]{2,80})/i,
    build: (m) => ({ intent: 'blast_radius', label: m[1] }),
  },
  {
    rx: /what\s+does\s+([\w./@:-]{2,80})\s+affect/i,
    build: (m) => ({ intent: 'blast_radius', label: m[1] }),
  },
  {
    rx: /(?:who|what)\s+depends?\s+on\s+([\w./@:-]{2,80})/i,
    build: (m) => ({ intent: 'dependents', label: m[1] }),
  },
  {
    rx: /dependents\s+of\s+([\w./@:-]{2,80})/i,
    build: (m) => ({ intent: 'dependents', label: m[1] }),
  },
  {
    rx: /what\s+does\s+([\w./@:-]{2,80})\s+depend\s+on/i,
    build: (m) => ({ intent: 'dependencies', label: m[1] }),
  },
  {
    rx: /dependencies\s+of\s+([\w./@:-]{2,80})/i,
    build: (m) => ({ intent: 'dependencies', label: m[1] }),
  },
  {
    rx: /(?:shortest\s+)?path\s+from\s+([\w./@:-]{2,80})\s+to\s+([\w./@:-]{2,80})/i,
    build: (m) => ({ intent: 'path', label: m[1], toLabel: m[2] }),
  },
]

export function detectGraphQuery(question: string): GraphQueryDetection | null {
  const trimmed = question.trim()
  for (const { rx, build } of PATTERNS) {
    const m = rx.exec(trimmed)
    if (m) {
      const out = build(m)
      // Strip trailing punctuation that the regex captured.
      out.label = out.label.replace(/[.?!,:;]+$/, '')
      if (out.toLabel) out.toLabel = out.toLabel.replace(/[.?!,:;]+$/, '')
      return out
    }
  }
  return null
}

/**
 * Quote a string literal for Postgres in a way that's safe to inline into a
 * dynamic SQL fragment. We can't use parameterised binds because
 * `execute_readonly_query` only exposes a single $1 (project_id), so any
 * label has to be embedded — but the schema-hardening RPC also blocks
 * dangerous keywords, so we double-up: escape single quotes, then bound the
 * length, then reject anything that survived containing semicolons.
 */
function pgQuote(s: string): string {
  if (s.length > 200) throw new Error('label too long')
  if (/[;\\]/.test(s)) throw new Error('label contains forbidden char')
  return `'${s.replace(/'/g, "''")}'`
}

function buildSql(detection: GraphQueryDetection): { sql: string; explanation: string } {
  const depth = Math.min(MAX_DEPTH, Math.max(1, detection.maxDepth ?? 4))
  const limit = MAX_RESULTS

  if (detection.intent === 'blast_radius') {
    const label = pgQuote(detection.label)
    const sql = `
      WITH RECURSIVE
        seed AS (
          SELECT id FROM graph_nodes
           WHERE project_id = $1
             AND label = ${label}
           LIMIT 1
        ),
        walk AS (
          SELECT s.id AS target_id, 0 AS depth
            FROM seed s
          UNION
          SELECT e.target_node_id, w.depth + 1
            FROM walk w
            JOIN graph_edges e
              ON e.source_node_id = w.target_id
             AND e.project_id = $1
           WHERE w.depth < ${depth}
        )
      SELECT n.id, n.label, n.node_type, MIN(w.depth) AS depth
        FROM walk w
        JOIN graph_nodes n ON n.id = w.target_id AND n.project_id = $1
       WHERE w.depth > 0
       GROUP BY n.id, n.label, n.node_type
       ORDER BY depth, n.label
       LIMIT ${limit}
    `.trim()
    return {
      sql,
      explanation: `Blast radius of "${detection.label}" — every node reachable in up to ${depth} hops.`,
    }
  }

  if (detection.intent === 'dependents') {
    const label = pgQuote(detection.label)
    const sql = `
      WITH RECURSIVE
        seed AS (
          SELECT id FROM graph_nodes
           WHERE project_id = $1 AND label = ${label}
           LIMIT 1
        ),
        walk AS (
          SELECT s.id AS source_id, 0 AS depth
            FROM seed s
          UNION
          SELECT e.source_node_id, w.depth + 1
            FROM walk w
            JOIN graph_edges e
              ON e.target_node_id = w.source_id
             AND e.project_id = $1
           WHERE w.depth < ${depth}
        )
      SELECT n.id, n.label, n.node_type, MIN(w.depth) AS depth
        FROM walk w
        JOIN graph_nodes n ON n.id = w.source_id AND n.project_id = $1
       WHERE w.depth > 0
       GROUP BY n.id, n.label, n.node_type
       ORDER BY depth, n.label
       LIMIT ${limit}
    `.trim()
    return {
      sql,
      explanation: `Dependents of "${detection.label}" — every node that transitively points at it.`,
    }
  }

  if (detection.intent === 'dependencies') {
    const label = pgQuote(detection.label)
    const sql = `
      WITH RECURSIVE
        seed AS (
          SELECT id FROM graph_nodes
           WHERE project_id = $1 AND label = ${label}
           LIMIT 1
        ),
        walk AS (
          SELECT s.id AS target_id, 0 AS depth
            FROM seed s
          UNION
          SELECT e.target_node_id, w.depth + 1
            FROM walk w
            JOIN graph_edges e
              ON e.source_node_id = w.target_id
             AND e.project_id = $1
           WHERE w.depth < ${depth}
        )
      SELECT n.id, n.label, n.node_type, MIN(w.depth) AS depth
        FROM walk w
        JOIN graph_nodes n ON n.id = w.target_id AND n.project_id = $1
       WHERE w.depth > 0
       GROUP BY n.id, n.label, n.node_type
       ORDER BY depth, n.label
       LIMIT ${limit}
    `.trim()
    return {
      sql,
      explanation: `Dependencies of "${detection.label}" — outgoing edges (what it points at) up to ${depth} hops.`,
    }
  }

  if (detection.intent === 'path') {
    if (!detection.toLabel) throw new Error('path intent missing toLabel')
    const fromLabel = pgQuote(detection.label)
    const toLabel = pgQuote(detection.toLabel)
    const sql = `
      WITH RECURSIVE
        seed AS (
          SELECT id FROM graph_nodes
           WHERE project_id = $1 AND label = ${fromLabel}
           LIMIT 1
        ),
        target AS (
          SELECT id FROM graph_nodes
           WHERE project_id = $1 AND label = ${toLabel}
           LIMIT 1
        ),
        walk AS (
          SELECT s.id AS target_id,
                 ARRAY[s.id] AS path,
                 0 AS depth
            FROM seed s
          UNION ALL
          SELECT e.target_node_id,
                 w.path || e.target_node_id,
                 w.depth + 1
            FROM walk w
            JOIN graph_edges e
              ON e.source_node_id = w.target_id
             AND e.project_id = $1
           WHERE w.depth < ${depth}
             AND NOT (e.target_node_id = ANY(w.path))
        )
      SELECT (SELECT array_agg(n.label ORDER BY pathidx)
                FROM unnest(w.path) WITH ORDINALITY AS u(node_id, pathidx)
                JOIN graph_nodes n ON n.id = u.node_id) AS path_labels,
             w.depth AS hops
        FROM walk w, target t
       WHERE w.target_id = t.id
       ORDER BY hops
       LIMIT 1
    `.trim()
    return {
      sql,
      explanation: `Shortest path from "${detection.label}" to "${detection.toLabel}" (≤ ${depth} hops).`,
    }
  }

  throw new Error(`Unknown graph intent: ${(detection as { intent: string }).intent}`)
}

export async function executeGraphQuery(
  db: SupabaseClient,
  projectIds: string[],
  detection: GraphQueryDetection,
): Promise<{ sql: string; explanation: string; results: unknown[]; summary: string }> {
  const { sql, explanation } = buildSql(detection)

  const results: unknown[] = []
  for (const pid of projectIds) {
    const { data, error } = await db.rpc('execute_readonly_query', {
      query_text: sql,
      project_id_param: pid,
    })
    if (error) {
      log.warn('graph traversal failed', { projectId: pid, error: error.message })
      continue
    }
    if (Array.isArray(data)) results.push(...data)
    if (results.length >= MAX_RESULTS) break
  }

  const summary = buildSummary(detection, results)

  return { sql, explanation, results: results.slice(0, MAX_RESULTS), summary }
}

function buildSummary(detection: GraphQueryDetection, results: unknown[]): string {
  if (results.length === 0) {
    if (detection.intent === 'path') {
      return `No path found from "${detection.label}" to "${detection.toLabel}" within ${MAX_DEPTH} hops.`
    }
    return `No graph nodes found for "${detection.label}". The label may not be indexed yet.`
  }

  if (detection.intent === 'path') {
    const first = results[0] as { path_labels?: string[]; hops?: number }
    const path = (first?.path_labels ?? []).join(' → ')
    return `Found path in ${first?.hops ?? '?'} hops: ${path}`
  }

  const noun = detection.intent === 'blast_radius'
    ? 'downstream nodes'
    : detection.intent === 'dependents'
      ? 'dependents'
      : 'dependencies'
  const truncated = results.length >= MAX_RESULTS ? ` (truncated at ${MAX_RESULTS})` : ''
  return `Found ${results.length} ${noun} of "${detection.label}"${truncated}.`
}
