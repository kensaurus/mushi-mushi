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

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: toolArgs },
  }

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.pat}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    throw new Error(`Supabase MCP error: HTTP ${res.status} — ${await res.text().catch(() => '?')}`)
  }

  const json = await res.json() as {
    result?: { content?: Array<{ text?: string }> }
    error?: { message?: string }
  }

  if (json.error) {
    throw new Error(`Supabase MCP tool error: ${json.error.message ?? JSON.stringify(json.error)}`)
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
  const result = await callTool<{ advisors?: AdvisorResult[] }>(opts, 'get_advisors', {})
  return result.advisors ?? []
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
  const { data, error } = await db
    .from('byok_keys')
    .select('vault_secret_id')
    .eq('project_id', projectId)
    .eq('provider_slug', 'supabase')
    .eq('status', 'active')
    .order('priority', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data?.vault_secret_id) return null

  const { data: secret, error: secretErr } = await db.rpc('vault_get_secret', {
    secret_id: data.vault_secret_id as string,
  })
  if (secretErr || typeof secret !== 'string' || !secret) return null
  return secret
}

// ─── Extended helpers ────────────────────────────────────────────────────────

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
  const result = await callTool<TableInfo[] | { tables?: TableInfo[] }>(opts, 'list_tables', {
    schema: 'public',
    include_columns: true,
  })
  const tables = Array.isArray(result) ? result : (result.tables ?? [])
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
  const result = await callTool<LogEntry[] | { logs?: LogEntry[] }>(opts, 'get_logs', {
    service,
    limit: options.limit ?? 100,
    min_level: options.minLevel ?? 'error',
  })
  return Array.isArray(result) ? result : (result.logs ?? [])
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
