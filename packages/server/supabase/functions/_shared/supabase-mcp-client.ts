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
 * Returns null when the key hasn't been configured yet.
 */
export async function resolveSupabasePat(
  db: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('byok_keys')
    .select('api_key')
    .eq('project_id', projectId)
    .eq('provider_slug', 'supabase')
    .single()

  if (error || !data?.api_key) return null
  return data.api_key as string
}
