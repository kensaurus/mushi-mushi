import { generateObject, generateText } from 'npm:ai@4'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { z } from 'npm:zod@3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createTrace } from './observability.ts'
import { resolveLlmKey } from './byok.ts'
import { detectGraphQuery, executeGraphQuery } from './graph-nl.ts'

// SEC (Wave S1 / D-12): widen the blocklist. The original regex missed
// administrative and filesystem-style verbs that happen to be valid Postgres
// statements or extensions — e.g. `COPY ... TO PROGRAM`, `LOCK TABLE`,
// `REFRESH MATERIALIZED VIEW`, `SET ROLE`, `SELECT pg_read_server_files(...)`.
// None of these belong in a self-serve NL-to-SQL flow. The RPC is also
// recommended to run as SECURITY INVOKER under a dedicated `nl_query_reader`
// role (see migration 20260421_nl_query_reader_role.sql) so even if this
// guard were bypassed the role has no rights on system catalogs.
const DANGEROUS_PATTERNS = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|exec|execute|copy|lock|refresh|reindex|vacuum|analyze|cluster|listen|notify|set\s+role|reset\s+role|pg_read_server_files|pg_write_server_files|pg_ls_dir|dblink|current_setting\s*\(\s*'pgrst|pg_sleep|pg_terminate_backend|pg_cancel_backend)\b/i

// Catch queries that try to reach beyond the approved read schema. We only
// bless `public` + curated views. Any reference to `pg_catalog`, `information_schema`,
// `auth`, `storage`, etc. gets rejected regardless of SELECT semantics — those
// schemas either hold secrets (auth.users) or administrative surface area.
const FORBIDDEN_SCHEMAS = /\b(pg_catalog|information_schema|auth|storage|realtime|supabase_functions|vault|pgsodium|extensions)\s*\./i

const sqlSchema = z.object({
  sql: z.string().describe('A SELECT-only SQL query. Use $1 as placeholder for project_id.'),
  explanation: z.string().describe('Brief explanation of what this query does'),
})

const SCHEMA_CONTEXT = `Available tables and columns:
- reports: id, project_id, status, category, severity, summary, component, description, confidence, created_at, judge_score, bug_ontology_tags, regressed_at, fix_pr_url, fixed_at
- report_groups: id, project_id, canonical_report_id, status, report_count, created_at
- classification_evaluations: id, project_id, report_id, judge_score, accuracy_score, severity_score, component_score, repro_score, created_at
- reporter_reputation: id, project_id, reporter_token_hash, reputation_score, total_points, confirmed_bugs, dismissed_reports, total_reports
- graph_nodes: id, project_id, node_type, label, metadata, created_at
- graph_edges: id, project_id, source_node_id, target_node_id, edge_type, weight, created_at
- bug_ontology: id, project_id, tag, parent_tag, description, usage_count
- fix_attempts: id, report_id, project_id, agent, status, pr_url, files_changed, lines_changed, summary, started_at, completed_at
- fix_verifications: id, report_id, verification_status, visual_diff_score, verified_at

Always filter by project_id = $1. Always LIMIT to 100 rows max.`

export async function executeNaturalLanguageQuery(
  db: SupabaseClient,
  projectIds: string[],
  question: string,
): Promise<{ sql: string; explanation: string; results: unknown[]; summary: string }> {
  // §3d: short-circuit graph-shaped questions (blast radius, depends
  // on, path between) into a recursive-CTE traversal. Avoids the LLM SQL
  // generator hand-writing buggy `WITH RECURSIVE` queries against
  // graph_nodes/graph_edges, and gives deterministic answers.
  const graphIntent = detectGraphQuery(question)
  if (graphIntent && projectIds.length > 0) {
    const trace = createTrace('nl-query', {
      question: question.slice(0, 100),
      mode: 'graph',
      intent: graphIntent.intent,
    })
    const span = trace.span('graph-traverse')
    try {
      const out = await executeGraphQuery(db, projectIds, graphIntent)
      span.end({ rows: out.results.length })
      await trace.end()
      return out
    } catch (e) {
      span.end({ error: (e as Error).message })
      await trace.end()
      // Fall through to LLM SQL — graph traversal failures shouldn't break
      // the user's question entirely.
    }
  }

  // §3a: BYOK-resolve Anthropic against the first project the user
  // owns. Falls back to the env key if the project hasn't configured BYOK.
  // Resolution failures are non-fatal — `resolved` is null and we use env.
  const resolved = projectIds.length > 0
    ? await resolveLlmKey(db, projectIds[0], 'anthropic').catch(() => null)
    : null
  const apiKey = resolved?.key ?? Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('No Anthropic key available (BYOK or env)')
  const anthropic = createAnthropic({ apiKey })
  const trace = createTrace('nl-query', {
    question: question.slice(0, 100),
    keySource: resolved?.source ?? 'env',
    mode: 'llm-sql',
  })

  const planSpan = trace.span('generate-sql')
  const { object: queryPlan, usage: planUsage } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: sqlSchema,
    system: `You are a SQL query generator. Generate a single SELECT query that answers the user's question about their bug reports.\n\n${SCHEMA_CONTEXT}`,
    prompt: question,
  })
  planSpan.end({ model: 'claude-sonnet-4-6', inputTokens: planUsage?.promptTokens, outputTokens: planUsage?.completionTokens })

  if (DANGEROUS_PATTERNS.test(queryPlan.sql)) {
    throw new Error('Query contains disallowed operations. Only SELECT queries are permitted.')
  }

  if (FORBIDDEN_SCHEMAS.test(queryPlan.sql)) {
    throw new Error('Query references a restricted schema. Only the curated `public` tables are queryable.')
  }

  if (!/^\s*(with\s|select\s)/i.test(queryPlan.sql.trim())) {
    throw new Error('Only SELECT / WITH queries are permitted.')
  }

  if (!queryPlan.sql.toLowerCase().includes('$1')) {
    throw new Error('Query must include project_id filter ($1)')
  }

  // Sanitise: strip inline SQL comments and trailing semicolons. The RPC
  // wraps the query as `from (...) t`, so a stray `;` breaks parsing with
  // "syntax error at or near ';'". Hard-fail on intra-statement `;` to
  // catch attempts at multi-statement execution.
  const cleanedSql = queryPlan.sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/;\s*$/g, '')
    .trim()
  if (cleanedSql.includes(';')) {
    throw new Error('Multi-statement queries are not allowed.')
  }

  const results: unknown[] = []
  for (const projectId of projectIds) {
    const { data, error } = await db.rpc('execute_readonly_query', {
      query_text: cleanedSql,
      project_id_param: projectId,
    })

    if (error) {
      throw new Error(`Query execution failed: ${error.message}`)
    }

    if (data) results.push(...(Array.isArray(data) ? data : [data]))
    if (results.length >= 100) break
  }

  const summarySpan = trace.span('summarize')
  const { text: summary, usage: summaryUsage } = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    prompt: `Summarize these query results in 2-3 sentences for a developer.\n\nQuestion: ${question}\nResults (${results.length} rows): ${JSON.stringify(results.slice(0, 20))}`,
  })
  summarySpan.end({ model: 'claude-haiku-4-5-20251001', inputTokens: summaryUsage?.promptTokens, outputTokens: summaryUsage?.completionTokens })
  await trace.end()

  return {
    sql: cleanedSql,
    explanation: queryPlan.explanation,
    results: results.slice(0, 100),
    summary,
  }
}
