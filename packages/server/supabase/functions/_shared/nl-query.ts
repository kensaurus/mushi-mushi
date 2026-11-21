import { z } from 'npm:zod@3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createTrace } from './observability.ts'
import type { ResolvedKey } from './byok.ts'
import { detectGraphQuery, executeGraphQuery } from './graph-nl.ts'
import {
  NL_QUERY_PLANNER_EFFORT,
  NL_QUERY_PLANNER_FALLBACK,
  NL_QUERY_PLANNER_MODEL,
  NL_QUERY_SUMMARY_FALLBACK,
  NL_QUERY_SUMMARY_MODEL,
  THINKING_HEADROOM_TOKENS,
} from './models.ts'
import { claudeGenerateObject, claudeGenerateText } from './claude-messages.ts'
import { withLlmUsage } from './llm-usage.ts'
import { getPromptForStage } from './prompt-ab.ts'

// These text checks are defence in depth, not the tenant boundary. The boundary
// is in the database (migration 20260923000003_nl_query_role_containment):
// execute_readonly_query runs the SQL as `mushi_nl_reader`, which can SELECT
// only the analytics tables below and only the one project's rows, and it
// blanks PostgREST's request.* settings first. Keep this list in step with the
// one in that function.
const DANGEROUS_PATTERNS = /\b(insert|update|delete|merge|drop|truncate|alter|create|grant|revoke|exec|execute|copy|lock|refresh|reindex|vacuum|analyze|cluster|listen|notify|prepare|deallocate|discard|reset|set\s+role|pg_read_server_files|pg_write_server_files|pg_read_file|pg_read_binary_file|pg_ls_dir|dblink|set_config|current_setting|pg_notify|pg_settings|pg_show_all_settings|pg_db_role_setting|pg_stat_activity|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_advisory_lock|pg_advisory_xact_lock|lo_import|lo_export|lo_create|lo_from_bytea|lo_put|query_to_xml|query_to_xml_and_xmlschema|cursor_to_xml|table_to_xml|schema_to_xml|database_to_xml|nl_query_scope)\b/i

// Catch queries that try to reach beyond the approved read schema. We only
// bless `public` + curated views. Any reference to `pg_catalog`, `information_schema`,
// `auth`, `storage`, etc. gets rejected regardless of SELECT semantics — those
// schemas either hold secrets (auth.users) or administrative surface area.
const FORBIDDEN_SCHEMAS = /\b(pg_catalog|information_schema|pg_temp|pg_toast|auth|storage|realtime|supabase_functions|supabase_migrations|vault|pgsodium|extensions|net|cron|graphql|graphql_public|pgbouncer|pgmq|mushi_nl)\s*\./i

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
 * Remove `--` and block comments outside single-quoted literals. Returns the
 * SQL without comments (`sql`) and the same text with every literal emptied
 * to '' (`code`) for checks that must only see SQL tokens. Fails closed on
 * anything it cannot scan exactly: an unterminated literal or comment,
 * dollar quoting ($$ / $tag$), and E'...' strings whose backslash escapes
 * could hide a quote from this scanner.
 */
function stripSqlComments(input: string): { sql: string; code: string } {
  if (/\$[A-Za-z_]*\$/.test(input)) {
    throw new Error('Dollar-quoted strings are not allowed.')
  }
  let sql = ''
  let code = ''
  let i = 0
  while (i < input.length) {
    const c = input[i]
    const next = input[i + 1]
    if (c === '-' && next === '-') {
      while (i < input.length && input[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      const end = input.indexOf('*/', i + 2)
      if (end < 0) throw new Error('Unterminated block comment.')
      sql += ' '
      code += ' '
      i = end + 2
      continue
    }
    if (c === "'") {
      if (/[eE]/.test(input[i - 1] ?? '') && !/[A-Za-z0-9_]/.test(input[i - 2] ?? '')) {
        throw new Error("Escape strings (E'...') are not allowed.")
      }
      let j = i + 1
      for (;;) {
        if (j >= input.length) throw new Error('Unterminated string literal.')
        if (input[j] === "'") {
          if (input[j + 1] === "'") { j += 2; continue }
          break
        }
        j++
      }
      sql += input.slice(i, j + 1)
      code += "''"
      i = j + 1
      continue
    }
    sql += c
    code += c
    i++
  }
  return { sql, code }
}

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
  // A quoted name ("vault"."decrypted_secrets") slips past the \b…\s*\. schema
  // check above, so quoted identifiers are refused outright.
  if (sql.includes('"')) {
    throw new Error('Quoted identifiers are not allowed. Use unquoted snake_case names and aliases.')
  }

  // Strip inline SQL comments — they can hide injection payloads from the
  // regex checks above. Block comments (/* */) and line comments (--). The
  // scan skips '...' literals, so `LIKE '%--%'` keeps its text and a `;`
  // inside a string is not a second statement.
  const scanned = stripSqlComments(sql)
  let cleaned = scanned.sql.replace(/;\s*$/, '').trim() // trailing semicolon breaks the RPC wrapper
  const code = scanned.code.replace(/;\s*$/, '')

  // The raw-text checks above miss a name split by a comment:
  // `vault/**/.decrypted_secrets` becomes `vault .decrypted_secrets`, which
  // Postgres reads as a qualified name. Run them again on what will execute.
  if (DANGEROUS_PATTERNS.test(code)) {
    throw new Error('Query contains disallowed operations. Only SELECT queries are permitted.')
  }
  if (FORBIDDEN_SCHEMAS.test(code)) {
    throw new Error('Query references a restricted schema. Only the curated `public` tables are queryable.')
  }

  // SEC: this MUST run on code with comments AND literals removed, not on
  // the raw `sql`. Otherwise a user can satisfy the check by hiding `$1`
  // inside a comment (`SELECT * FROM reports /* $1 */ WHERE ...`) or a
  // string (`WHERE summary = '$1'`) — the RPC wrapper's `project_id_param`
  // goes unused and the query returns rows from every tenant.
  if (requireProjectIdParam && !code.includes('$1')) {
    throw new Error('Query must include project_id = $1 to scope results to your project.')
  }

  if (code.includes(';')) {
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
  if (!/\blimit\b/i.test(code)) {
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
Never use double quotes; write aliases in unquoted snake_case (e.g. AS bug_count).
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

  // §3a: the first project the user owns picks the keys: its own Claude key,
  // then its own OpenAI key, then the platform keys through the nl-query-plan
  // and nl-query-summary routes (provider and model from kenji; wallet and
  // budget checked in withAnthropicOrOpenAi). With no project there is no
  // organization to check, so it refuses.
  if (projectIds.length === 0) throw new Error('No app to query, so no AI provider to check')
  const projectId0 = projectIds[0]
  // The Sonnet planner goes through claude-messages.ts (Sonnet 5.5 rejects the
  // AI SDK v4 call shape); the Haiku summariser on the app's own key and the
  // OpenAI pool stay on the AI SDK, which loads here rather than at boot.
  const { createAnthropic, generateObject, generateText } = await import('./ai-sdk.ts')
  const { openAiProvider } = await import('./openai-compat.ts')
  const { withAnthropicOrOpenAi } = await import('./llm-failover.ts')
  const trace = createTrace('nl-query', {
    question: question.slice(0, 100),
    mode: 'llm-sql',
  })
  const usageCtx = {
    functionName: 'nl-query',
    projectId: projectId0,
    langfuseTraceId: trace.id,
    // A question the user asked in the console: billed on the platform key.
    billHosted: true,
  } as const

  const planSpan = trace.span('generate-sql')
  const nlPlanSelection = await getPromptForStage(db, projectId0, 'nl_plan')
  const nlPlanBasePrompt = nlPlanSelection.promptTemplate
    ?? `You are a SQL query generator. Generate a single SELECT query that answers the user's question about their bug reports.`
  const planSystem = `${nlPlanBasePrompt}\n\n${SCHEMA_CONTEXT}`
  type PlanResult = {
    object: z.infer<typeof sqlSchema>
    usage: { promptTokens: number; completionTokens: number }
  }
  /** One recorded plan call, on either family (one wrapper per call). */
  const plan = (key: ResolvedKey, family: 'anthropic' | 'openai') => {
    const model = key.model ?? (family === 'anthropic' ? NL_QUERY_PLANNER_MODEL : NL_QUERY_PLANNER_FALLBACK)
    return withLlmUsage(
      db,
      { ...usageCtx, keySource: key.source, stage: 'plan', model, promptVersion: nlPlanSelection.promptVersion ?? null },
      (): Promise<PlanResult> => family === 'openai'
        ? generateObject({
            model: openAiProvider({ apiKey: key.key, ...(key.baseUrl ? { baseURL: key.baseUrl } : {}) })(model),
            schema: sqlSchema,
            system: planSystem,
            prompt: question,
          })
        : claudeGenerateObject({
            apiKey: key.key,
            model,
            effort: NL_QUERY_PLANNER_EFFORT,
            schema: sqlSchema,
            system: planSystem,
            prompt: question,
          }),
    ).then((r) => ({ ...r, model }))
  }
  const planned = await withAnthropicOrOpenAi(
    db,
    projectId0,
    (key) => plan(key, 'anthropic'),
    (key) => plan(key, 'openai'),
    { feature: 'nl-query-plan', tier: 'standard' },
  )
  const queryPlan = planned.result.object
  planSpan.end({ model: planned.result.model, inputTokens: planned.result.usage?.promptTokens, outputTokens: planned.result.usage?.completionTokens })

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
  const nlSummarySelection = await getPromptForStage(db, projectId0, 'nl_summary')
  const summarySystem = nlSummarySelection.promptTemplate
    ?? 'Summarize these query results in 2-3 sentences for a developer. Never invent numbers not in the input.'
  const summaryPrompt = `Question: ${question}\nResults (${results.length} rows): ${JSON.stringify(results.slice(0, 20))}`
  /** One recorded summary call. A route's Claude model is 5.x, which only the Messages path takes. */
  const summarize = (key: ResolvedKey, family: 'anthropic' | 'openai') => {
    const model = key.model ?? (family === 'anthropic' ? NL_QUERY_SUMMARY_MODEL : NL_QUERY_SUMMARY_FALLBACK)
    const anthropic = createAnthropic({ apiKey: key.key })
    return withLlmUsage(
      db,
      { ...usageCtx, keySource: key.source, stage: 'summary', model, promptVersion: nlSummarySelection.promptVersion ?? null },
      (): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }> => family === 'anthropic' && key.model
        ? claudeGenerateText({ apiKey: key.key, model, effort: 'low', system: summarySystem, prompt: summaryPrompt, maxTokens: 400 + THINKING_HEADROOM_TOKENS })
        : generateText({
            model: family === 'openai'
              ? openAiProvider({ apiKey: key.key, ...(key.baseUrl ? { baseURL: key.baseUrl } : {}) })(model)
              : anthropic(NL_QUERY_SUMMARY_MODEL),
            system: summarySystem,
            prompt: summaryPrompt,
          }),
    ).then((r) => ({ text: r.text, usage: r.usage, model }))
  }
  const summarized = await withAnthropicOrOpenAi(
    db,
    projectId0,
    (key) => summarize(key, 'anthropic'),
    (key) => summarize(key, 'openai'),
    { feature: 'nl-query-summary', tier: 'fast' },
  )
  summarySpan.end({ model: summarized.result.model, inputTokens: summarized.result.usage?.promptTokens, outputTokens: summarized.result.usage?.completionTokens })
  await trace.end()

  return {
    sql: cleanedSql,
    explanation: queryPlan.explanation,
    results: results.slice(0, 100),
    summary: summarized.result.text,
  }
}
