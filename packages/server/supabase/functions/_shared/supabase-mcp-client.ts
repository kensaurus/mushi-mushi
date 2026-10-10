/**
 * FILE: _shared/supabase-mcp-client.ts
 * PURPOSE: Thin client that talks to the hosted Supabase MCP endpoint
 *          (`https://mcp.supabase.com/mcp`) as a downstream service.
 *
 * USAGE CONTEXT: Admin-only edge functions that need live Supabase schema
 * introspection or advisor data (e.g. the Schema-Repair Diagnostic card).
 * Always called with `?read_only=true` — never performs mutations on the
 * downstream Supabase MCP.
 *
 * AUTH: The calling org's Supabase PAT is stored under slug `supabase` in the
 * `byok_keys` table (same BYOK pattern used for Firecrawl / Browserbase /
 * OpenAI). The PAT is resolved by `resolveByokKey(projectId, 'supabase')`.
 *
 * RATE LIMITS: Supabase MCP is rate-limited per PAT. All responses are cached
 * for 60 s in the edge function's in-memory map so a single admin page refresh
 * doesn't fan out N simultaneous tool calls.
 */

// Import the type from the same npm specifier the rest of the edge functions
// use (`_shared/db.ts`). Mixing the jsr and npm builds of supabase-js makes
// their `SupabaseClient` types structurally incompatible (protected
// `supabaseUrl`), which breaks `deno check` when a npm-typed client is passed
// to a function typed against the jsr build.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { keyOwnerFilter, ownKeysFirst, projectKeyOwner } from './byok-scope.ts'
import { mcpCallTool } from './mcp-http-session.ts'

const SUPABASE_MCP_URL = 'https://mcp.supabase.com/mcp'
const CACHE_TTL_MS = 60_000

// Edge-function-level in-memory cache (evicted on cold start).
const cache = new Map<string, { data: unknown; expiresAt: number }>()

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null }
  return entry.data as T
}

function cacheSet(key: string, data: unknown): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

export interface SupabaseMcpClientOptions {
  /** The target Supabase project ref (e.g. `xyzabcdef`). */
  projectRef: string
  /**
   * The org's Supabase Personal Access Token.
   * Resolved from `byok_keys` (slug: `supabase`) by the caller.
   */
  pat: string
}

/**
 * Call a Supabase MCP tool in read-only mode.
 *
 * The call is translated to the MCP JSON-RPC wire format:
 * `POST /mcp?project_ref=<ref>&read_only=true`
 * with body `{ method: "tools/call", params: { name, arguments } }`.
 */
async function callTool<T = unknown>(
  opts: SupabaseMcpClientOptions,
  toolName: string,
  toolArgs: Record<string, unknown> = {},
): Promise<T> {
  // Include the last 8 chars of the PAT so two orgs with the same projectRef
  // (misconfiguration) can never receive each other's cached advisor data.
  const cacheKey = `${opts.projectRef}:${opts.pat.slice(-8)}:${toolName}:${JSON.stringify(toolArgs)}`
  const cached = cacheGet<T>(cacheKey)
  if (cached !== null) return cached

  const url = new URL(SUPABASE_MCP_URL)
  url.searchParams.set('project_ref', opts.projectRef)
  url.searchParams.set('read_only', 'true')

  // Streamable HTTP with a session (initialize → Mcp-Session-Id → call).
  const r = await mcpCallTool({ url: url.toString(), token: opts.pat, timeoutMs: 15_000 }, toolName, toolArgs)
  if (r.status !== 200) {
    throw new Error(`Supabase MCP error: HTTP ${r.status} — ${r.error ?? '?'}`)
  }
  if (r.error) throw new Error(`Supabase MCP tool error: ${r.error}`)
  const json = { result: r.result ?? undefined }
  if (r.result?.isError) {
    throw new Error(`Supabase MCP tool error: ${(r.result.content?.[0]?.text ?? 'tool error').slice(0, 200)}`)
  }

  // Extract the tool result from the MCP text content block.
  const text = json.result?.content?.[0]?.text
  if (!text) throw new Error('Supabase MCP returned empty result')

  let parsed: T
  try { parsed = JSON.parse(text) as T } catch { parsed = text as unknown as T }

  cacheSet(cacheKey, parsed)
  return parsed
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface AdvisorResult {
  name: string
  title?: string
  description: string
  level?: string
  metadata?: Record<string, unknown>
}

/**
 * Fetch Supabase database performance + security advisors for the project.
 * Calls `get_advisors` on the Supabase MCP.
 *
 * Used by the Schema-Repair Diagnostic card in the admin dashboard.
 */
export async function getSupabaseAdvisors(
  opts: SupabaseMcpClientOptions,
): Promise<AdvisorResult[]> {
  // get_advisors now requires a type; fetch both kinds.
  const [security, performance] = await Promise.all([
    callTool<unknown>(opts, 'get_advisors', { type: 'security' }),
    callTool<unknown>(opts, 'get_advisors', { type: 'performance' }),
  ])
  return [...normalizeAdvisors(security), ...normalizeAdvisors(performance)]
}

/** `{ lints: [...] }` (current), `{ result: { lints } }` or `{ advisors }` → AdvisorResult[]. */
export function normalizeAdvisors(raw: unknown): AdvisorResult[] {
  const r = (raw ?? {}) as Record<string, unknown>
  const inner = (r.result && typeof r.result === 'object' ? r.result : r) as Record<string, unknown>
  const list = (Array.isArray(inner.lints) ? inner.lints : Array.isArray(inner.advisors) ? inner.advisors : []) as Array<Record<string, unknown>>
  return list.map((l) => ({
    name: String(l.name ?? ''),
    title: typeof l.title === 'string' ? l.title : undefined,
    description: String(l.description ?? l.detail ?? ''),
    level: typeof l.level === 'string' ? l.level : undefined,
    metadata: {
      ...(typeof l.remediation === 'string' ? { remediation: l.remediation } : {}),
      ...(typeof l.count === 'number' ? { count: l.count } : {}),
      ...(Array.isArray(l.findings) ? { findings: l.findings } : {}),
      ...(l.metadata && typeof l.metadata === 'object' ? (l.metadata as Record<string, unknown>) : {}),
    },
  }))
}

/**
 * Resolve the Supabase PAT for a given project from the `byok_keys` table.
 *
 * `byok_keys` never stores the raw secret — it stores a `vault_secret_id`
 * pointing at Supabase Vault — so we select the vault reference for the
 * highest-priority active key under slug `supabase` and dereference it via the
 * `vault_get_secret` RPC (the same path `_shared/byok.ts` uses for LLM keys).
 * Returns null when the key hasn't been configured yet or can't be resolved.
 */
export async function resolveSupabasePat(
  db: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data: rows, error } = await db
    .from('byok_keys')
    .select('vault_secret_id, project_id, priority')
    .or(keyOwnerFilter(await projectKeyOwner(db, projectId)))
    .eq('provider_slug', 'supabase')
    .eq('status', 'active')
    .order('priority', { ascending: true })
    .limit(20)

  // The app's own token first (ADR 0023); Supabase tokens are not shareable now.
  const data = rows ? ownKeysFirst(rows as Array<{ vault_secret_id: string | null; project_id: string | null; priority: number | null }>)[0] : null
  if (error || !data?.vault_secret_id) return null

  const { data: secret, error: secretErr } = await db.rpc('vault_get_secret', {
    secret_id: data.vault_secret_id as string,
  })
  if (secretErr || typeof secret !== 'string' || !secret) return null
  return secret
}

// ─── Extended helpers ────────────────────────────────────────────────────────

/**
 * `list_tables` output → TableInfo[]. Current shape: `{ tables: [{ name:
 * "public.x", rls_enabled, columns: [{ name, data_type, options: ["nullable", …] }] }] }`;
 * older servers returned a bare array with `schema` and `type`/`nullable`.
 */
export function normalizeMcpTables(raw: unknown): TableInfo[] {
  const r = (raw ?? {}) as Record<string, unknown>
  const list = (Array.isArray(raw) ? raw : Array.isArray(r.tables) ? r.tables : []) as Array<Record<string, unknown>>
  return list.map((t) => {
    const full = String(t.name ?? '')
    const dot = full.indexOf('.')
    const schema = typeof t.schema === 'string' ? t.schema : dot > 0 ? full.slice(0, dot) : 'public'
    const name = typeof t.schema === 'string' || dot <= 0 ? full : full.slice(dot + 1)
    const cols = (Array.isArray(t.columns) ? t.columns : []) as Array<Record<string, unknown>>
    return {
      name,
      schema,
      rls_enabled: Boolean(t.rls_enabled),
      columns: cols.map((c) => ({
        name: String(c.name ?? ''),
        type: String(c.type ?? c.data_type ?? ''),
        nullable: typeof c.nullable === 'boolean' ? c.nullable : Array.isArray(c.options) && c.options.includes('nullable'),
      })),
      ...(typeof t.rows === 'number' ? { row_count_estimate: t.rows } : {}),
    }
  })
}

/**
 * The edge functions from `list_edge_functions`: a bare array before, and
 * `{ functions: [...] }` now (glot.it radar, 2026-10-05: "fns.map is not a
 * function" errored five rules). Untrusted-data delimiters are unwrapped.
 * Anything without a list is null — "could not list", never "no functions".
 */
export function normalizeMcpEdgeFunctions(raw: unknown): Array<Record<string, unknown>> | null {
  const v = unwrapUntrusted(raw)
  const list = Array.isArray(v) ? v : v && typeof v === 'object' ? (v as { functions?: unknown }).functions : null
  if (!Array.isArray(list)) return null
  return list.filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
}

/**
 * Query tools answer with text that wraps the JSON in
 * `<untrusted-data-…>` delimiters; return the parsed JSON inside, or the
 * input unchanged when it is not such a string.
 */
export function unwrapUntrusted(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const m = /<untrusted-data-[\w-]+>\s*([\s\S]*?)\s*<\/untrusted-data-[\w-]+>/.exec(raw)
  if (!m) return raw
  try {
    return JSON.parse(m[1])
  } catch {
    return raw
  }
}

export interface TableInfo {
  name: string
  schema: string
  rls_enabled: boolean
  columns: Array<{ name: string; type: string; nullable: boolean }>
  row_count_estimate?: number
}

export interface FunctionInfo {
  name: string
  schema: string
  language: string
  security_definer: boolean
}

export interface LogEntry {
  timestamp: string
  level: string
  message: string
  metadata?: Record<string, unknown>
}

/**
 * List tables in the linked host-app Supabase project.
 * When `prefixFilter` is provided, only tables starting with that prefix are returned.
 * Calls the `list_tables` tool on the hosted Supabase MCP.
 */
export async function listTables(
  opts: SupabaseMcpClientOptions,
  prefixFilter?: string,
): Promise<TableInfo[]> {
  // Current tool arguments: { schemas, verbose } (schema/include_columns are refused).
  const result = await callTool<unknown>(opts, 'list_tables', { schemas: ['public'], verbose: true })
  const tables = normalizeMcpTables(result)
  if (!prefixFilter) return tables
  return tables.filter((t) => t.name.startsWith(prefixFilter))
}

/**
 * Fetch recent API or Postgres logs for the linked host-app project.
 * Calls `get_logs` on the hosted Supabase MCP (read-only).
 * Returns the 100 most recent entries at or above ERROR level by default.
 */
export async function getLogs(
  opts: SupabaseMcpClientOptions,
  service: 'api' | 'postgres',
  options: { limit?: number; minLevel?: 'info' | 'warn' | 'error' } = {},
): Promise<LogEntry[]> {
  // get_logs was replaced by query_logs (ClickHouse SQL over the unified
  // log stream). The SQL is built from fixed templates: only a clamped number
  // and enum-derived lists are interpolated.
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500)
  const min = options.minLevel ?? 'error'
  const sql = service === 'api'
    ? `select timestamp, event_message, log_attributes['response.status_code'] as level from logs where source = 'edge_logs' and toInt32OrZero(log_attributes['response.status_code']) >= ${min === 'error' ? 500 : min === 'warn' ? 400 : 0} order by timestamp desc limit ${limit}`
    : `select timestamp, event_message, log_attributes['parsed.error_severity'] as level from logs where source = 'postgres_logs'${min === 'info' ? '' : ` and log_attributes['parsed.error_severity'] in (${min === 'error' ? "'ERROR','FATAL','PANIC'" : "'WARNING','ERROR','FATAL','PANIC'"})`} order by timestamp desc limit ${limit}`
  const result = unwrapUntrusted(await callTool<unknown>(opts, 'query_logs', { sql }))
  const r = (result ?? {}) as Record<string, unknown>
  const rows = (Array.isArray(result) ? result : Array.isArray(r.result) ? r.result : []) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    timestamp: String(row.timestamp ?? ''),
    level: String(row.level ?? ''),
    message: String(row.event_message ?? ''),
  }))
}

/**
 * List edge/pg functions in the linked host-app Supabase project.
 * Calls `list_edge_functions` on the hosted Supabase MCP (read-only).
 */
export async function listFunctions(
  opts: SupabaseMcpClientOptions,
): Promise<FunctionInfo[]> {
  const result = await callTool<FunctionInfo[] | { functions?: FunctionInfo[] }>(
    opts,
    'list_edge_functions',
    {},
  )
  return Array.isArray(result) ? result : (result.functions ?? [])
}

/**
 * Produce a canonical, order-independent JSON string for a value: object keys
 * are sorted recursively at every level so that two schemas that differ only in
 * key ordering hash identically, while any change to a value, key, or array
 * element changes the output. Array order is preserved (it is significant).
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}

/**
 * The part of a table that is its schema: name, schema, RLS and the columns
 * sorted by name. The row-count estimate changes every day without any schema
 * change, so it is left out: with it, glot.it's 201 unchanged tables were
 * reported as changed on every daily scan (2026-10-07).
 */
export function schemaShape(tables: readonly TableInfo[]): Array<Omit<TableInfo, 'row_count_estimate'>> {
  return tables
    .map((t) => ({
      name: t.name,
      schema: t.schema,
      rls_enabled: t.rls_enabled,
      columns: [...(t.columns ?? [])]
        .map((c) => ({ name: c.name, type: c.type, nullable: c.nullable }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`))
}

/**
 * Pure: added, removed and changed tables between two reads, by schema shape.
 * The previous read comes back from jsonb with its keys reordered, so tables
 * are compared canonically, never by JSON.stringify.
 */
export function diffSchemaShapes(
  prev: readonly TableInfo[],
  curr: readonly TableInfo[],
): { added: string[]; removed: string[]; modified: string[] } {
  const key = (t: TableInfo) => t.name
  const prevMap = new Map(schemaShape(prev).map((t) => [key(t), canonicalize(t)]))
  const currMap = new Map(schemaShape(curr).map((t) => [key(t), canonicalize(t)]))
  return {
    added: [...currMap.keys()].filter((k) => !prevMap.has(k)),
    removed: [...prevMap.keys()].filter((k) => !currMap.has(k)),
    modified: [...currMap].filter(([k, v]) => prevMap.has(k) && prevMap.get(k) !== v).map(([k]) => k),
  }
}

/**
 * Compute a deterministic SHA-256 hex hash of a JSON-serialisable value.
 * Used by backend-drift-scanner to detect schema changes without a full diff.
 *
 * NOTE: This uses a recursive canonical serialization. The previous
 * implementation passed `Object.keys(schema).sort()` as the `JSON.stringify`
 * replacer array, which (a) only whitelisted top-level keys — stripping all
 * nested content — and (b) is ignored entirely for arrays, so the digest was
 * effectively content-blind and could not detect dropped columns or RLS
 * changes. `canonicalize` walks the whole structure.
 */
export async function hashSchema(schema: unknown): Promise<string> {
  const text = canonicalize(schema)
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
