import { generateObject, generateText } from 'npm:ai@4'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { z } from 'npm:zod@3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createTrace } from './observability.ts'
import { resolveLlmKey } from './byok.ts'
import { detectGraphQuery, executeGraphQuery } from './graph-nl.ts'
import { NL_QUERY_PLANNER_MODEL, NL_QUERY_SUMMARY_MODEL } from './models.ts'
import { getPromptForStage } from './prompt-ab.ts'

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

// Approved table allowlist for raw SQL mode (defense-in-depth: prevents
// UNION SELECT from nl_query_history, audit_logs, byok_audit_log, etc.).
// The NL path relies on the LLM only generating queries against the schema
// context, but raw SQL is user-typed and must be explicitly restricted.
// Tables not in this list may still be mentioned in SCHEMA_CONTEXT for LLM
// context — they just can't be queried in raw SQL mode.
const APPROVED_TABLES = new Set([
  'reports',
  'report_groups',
  'classification_evaluations',
  'reporter_reputation',
  'reporter_devices',
  'graph_nodes',
  'graph_edges',
  'bug_ontology',
  'fix_attempts',
  'fix_verifications',
  'fix_events',
  'llm_invocations',
  'anti_gaming_events',
])

// Match bare table name references. We check FROM, JOIN, and INTO (WITH ... AS)
// clauses. Note: this is a heuristic guard, not a full SQL parser. The
// SECURITY DEFINER search_path + statement_timeout are the true containment.
const TABLE_REF_RE = /(?:from|join|into)\s+([a-z_][a-z0-9_]*)/gi

/**
 * Shared SQL sanitization applied to BOTH NL-generated SQL and raw user SQL.
 * Returns the cleaned SQL string or throws with a descriptive message.
 *
 * For raw SQL mode, pass `tableAllowlist: true` to enforce the approved table
 * list (the NL path doesn't need this because the LLM is constrained by
 * SCHEMA_CONTEXT; raw SQL is typed by a human and must be explicitly scoped).
 */
export function sanitizeSql(
  sql: string,
  opts: { tableAllowlist?: boolean; requireProjectIdParam?: boolean } = {},
): string {
  const { tableAllowlist = false, requireProjectIdParam = true } = opts

  if (!sql || !sql.trim()) throw new Error('SQL cannot be empty.')
  if (sql.length > 4_000) throw new Error('SQL too long (max 4 000 characters).')

  if (DANGEROUS_PATTERNS.test(sql)) {
    throw new Error('Query contains disallowed operations. Only SELECT queries are permitted.')
  }
  if (FORBIDDEN_SCHEMAS.test(sql)) {
    throw new Error('Query references a restricted schema. Only the curated `public` tables are queryable.')
  }
  if (!/^\s*(with\s|select\s)/i.test(sql.trim())) {
    throw new Error('Only SELECT / WITH queries are permitted.')
  }
  if (requireProjectIdParam && !sql.toLowerCase().includes('$1')) {
    throw new Error('Query must include project_id = $1 to scope results to your project.')
  }

  // Strip inline SQL comments — they can hide injection payloads from the
  // regex checks above. Block comments (/* */) and line comments (--).
  let cleaned = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/;\s*$/g, '') // trailing semicolon breaks the RPC wrapper
    .trim()

  if (cleaned.includes(';')) {
    throw new Error('Multi-statement queries are not allowed.')
  }

  if (tableAllowlist) {
    const mentioned: string[] = []
    let m: RegExpExecArray | null
    TABLE_REF_RE.lastIndex = 0
    while ((m = TABLE_REF_RE.exec(cleaned)) !== null) {
      const tbl = m[1]!.toLowerCase()
      if (!APPROVED_TABLES.has(tbl)) mentioned.push(tbl)
    }
    if (mentioned.length > 0) {
      throw new Error(
        `Table(s) not in approved list: ${mentioned.join(', ')}. ` +
        `Allowed: ${[...APPROVED_TABLES].join(', ')}.`,
      )
    }
  }

  // Auto-append LIMIT 100 if the query has no LIMIT clause. The NL prompt
  // always asks for LIMIT, but raw SQL users may forget.
  if (!/\blimit\b/i.test(cleaned)) {
    cleaned = `${cleaned}\nLIMIT 100`
  }

  return cleaned
}

const sqlSchema = z.object({
  sql: z.string().describe('A SELECT-only SQL query. Use $1 as placeholder for project_id.'),
  explanation: z.string().describe('Brief explanation of what this query does'),
})

// Severity values: 'critical' (P0), 'high' (P1), 'medium' (P2), 'low' (P3).
// Status values: 'new', 'pending', 'submitted', 'queued', 'classified',
//   'grouped', 'fixing', 'fixed', 'dismissed'.
// Category values: 'bug', 'slow', 'visual', 'confusing', 'other'.
const SCHEMA_CONTEXT = `Available tables and columns:
- reports: id, project_id, status, category, severity, summary, component, description, confidence, created_at, judge_score, bug_ontology_tags, regressed_at, fix_pr_url, fixed_at, screenshot_url, console_logs, app_version, sdk_version, reporter_token_hash, session_id
- report_groups: id, project_id, canonical_report_id, status, report_count, created_at
- classification_evaluations: id, project_id, report_id, judge_score, accuracy_score, severity_score, component_score, repro_score, created_at
- reporter_reputation: id, project_id, reporter_token_hash, reputation_score, total_points, confirmed_bugs, dismissed_reports, total_reports
- graph_nodes: id, project_id, node_type, label, metadata, created_at
- graph_edges: id, project_id, source_node_id, target_node_id, edge_type, weight, created_at
- bug_ontology: id, project_id, tag, parent_tag, description, usage_count
- fix_attempts: id, report_id, project_id, agent, status, pr_url, files_changed, lines_changed, summary, started_at, completed_at
- fix_verifications: id, report_id, verification_status, visual_diff_score, verified_at

Severity mapping: severity = 'critical' means P0, severity = 'high' means P1, severity = 'medium' means P2, severity = 'low' means P3.
Always filter by project_id = $1. Always LIMIT to 100 rows max.
Date functions: use date_trunc('week', now()) for current week start, (now() - INTERVAL '7 days') for last 7 days.`

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
  const nlPlanSelection = projectIds.length > 0
    ? await getPromptForStage(db, projectIds[0], 'nl_plan')
    : { promptTemplate: null, promptVersion: null, isCandidate: false }
  const nlPlanBasePrompt = nlPlanSelection.promptTemplate
    ?? `You are a SQL query generator. Generate a single SELECT query that answers the user's question about their bug reports.`
  const { object: queryPlan, usage: planUsage } = await generateObject({
    model: anthropic(NL_QUERY_PLANNER_MODEL),
    schema: sqlSchema,
    system: `${nlPlanBasePrompt}\n\n${SCHEMA_CONTEXT}`,
    prompt: question,
  })
  planSpan.end({ model: NL_QUERY_PLANNER_MODEL, inputTokens: planUsage?.promptTokens, outputTokens: planUsage?.completionTokens })

  const cleanedSql = sanitizeSql(queryPlan.sql, { requireProjectIdParam: true })

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
  const nlSummarySelection = projectIds.length > 0
    ? await getPromptForStage(db, projectIds[0], 'nl_summary')
    : { promptTemplate: null, promptVersion: null, isCandidate: false }
  const summarySystem = nlSummarySelection.promptTemplate
    ?? 'Summarize these query results in 2-3 sentences for a developer. Never invent numbers not in the input.'
  const { text: summary, usage: summaryUsage } = await generateText({
    model: anthropic(NL_QUERY_SUMMARY_MODEL),
    system: summarySystem,
    prompt: `Question: ${question}\nResults (${results.length} rows): ${JSON.stringify(results.slice(0, 20))}`,
  })
  summarySpan.end({ model: NL_QUERY_SUMMARY_MODEL, inputTokens: summaryUsage?.promptTokens, outputTokens: summaryUsage?.completionTokens })
  await trace.end()

  return {
    sql: cleanedSql,
    explanation: queryPlan.explanation,
    results: results.slice(0, 100),
    summary,
  }
}
