/**
 * FILE: packages/server/supabase/functions/_shared/connectors/supabase.ts
 * PURPOSE: The Supabase connector (Plan 019 §2b): legacy-backed — the BYOK
 *          `supabase` PAT and `project_settings.supabase_project_ref`.
 *          Supabase PATs cannot be scoped, so Mushi calls ONLY the hosted
 *          Supabase MCP with `read_only=true` and runs only SELECTs (the
 *          console says so before connect).
 *
 * Snapshot: tables, applied migration versions, advisors, edge functions
 * (with source for the auth check), SECURITY DEFINER functions that read
 * secrets, function grants, and storage bytes per bucket.
 * Drift: migration_unapplied / migration_unknown_remote (schema_drift),
 * and the radar's Supabase detectors (Plan 020 §4.2).
 *
 * config: { projectRef }  readCredential: the PAT.
 */

import {
  evaluateBackups,
  evaluateOrphanedStorage,
  evaluateSecretRpcs,
  evaluateUnauthenticatedPaidFunctions,
  SQL_FUNCTION_GRANTS,
  SQL_SECRET_RPCS,
  SQL_STORAGE_SIZES,
  type BucketSizeRow,
  type FunctionGrantRow,
  type SecretRpcRow,
} from '../radar/supabase-detectors.ts'
import { failureOfStatus, statusReason } from './http-util.ts'
import { ConnectorError, notConnected, type ConnectorContext, type DriftFinding, type RecipeConnector } from './types.ts'

const MCP_URL = 'https://mcp.supabase.com/mcp'
const REF_RE = /^[a-z0-9]{20}$/

export const SQL_APPLIED_MIGRATIONS = 'select version from supabase_migrations.schema_migrations order by version'

/**
 * The hosted MCP wraps query output in untrusted-data delimiters; the JSON
 * array sits between them. Returns null when no array can be read.
 */
export function parseMcpSqlText(text: string): unknown[] | null {
  const direct = (() => {
    try {
      const v = JSON.parse(text)
      return Array.isArray(v) ? v : null
    } catch {
      return null
    }
  })()
  if (direct) return direct
  const m = /<untrusted-data-[\w-]+>\s*([\s\S]*?)\s*<\/untrusted-data-[\w-]+>/.exec(text)
  if (!m) return null
  try {
    const v = JSON.parse(m[1])
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

async function tool(ctx: ConnectorContext, name: string, args: Record<string, unknown> = {}): Promise<{ status: number; text: string | null; error: string | null }> {
  const ref = String(ctx.config.projectRef)
  const url = `${MCP_URL}?project_ref=${encodeURIComponent(ref)}&read_only=true`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 20_000)
  try {
    const res = await ctx.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${ctx.readCredential}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: ac.signal,
    })
    if (res.status !== 200) return { status: res.status, text: null, error: statusReason('Supabase', res.status) }
    const body = await res.json().catch(() => null) as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } } | null
    if (!body || body.error) return { status: 200, text: null, error: body?.error?.message ?? 'Supabase MCP returned no result' }
    const text = body.result?.content?.[0]?.text ?? null
    if (body.result?.isError) return { status: 200, text: null, error: (text ?? 'tool error').slice(0, 200) }
    return { status: 200, text, error: null }
  } finally {
    clearTimeout(timer)
  }
}

async function sql<T>(ctx: ConnectorContext, query: string): Promise<T[] | null> {
  const r = await tool(ctx, 'execute_sql', { query })
  if (r.error || r.text == null) return null
  return parseMcpSqlText(r.text) as T[] | null
}

function json<T>(text: string | null): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/**
 * The radar's Supabase detectors over one snapshot's facts. Each returns a
 * full result (ok / finding / unknown), so the radar read model can say
 * "not checked" for a fact the read-only MCP could not give.
 */
export function supabaseRadarResults(f: Record<string, any>) {
  return [
    evaluateSecretRpcs(f.secretRpcs ?? null),
    evaluateOrphanedStorage({ billedBytes: f.billedStorageBytes ?? null, buckets: f.buckets ?? null }),
    evaluateUnauthenticatedPaidFunctions(f.functions ?? null),
    ...evaluateBackups({
      pitrEnabled: f.pitrEnabled ?? null,
      storageBytes: Array.isArray(f.buckets) ? f.buckets.reduce((n: number, b: BucketSizeRow) => n + Number(b.bytes || 0), 0) : null,
      storageObjects: Array.isArray(f.buckets) ? f.buckets.reduce((n: number, b: BucketSizeRow) => n + Number(b.objects || 0), 0) : null,
    }),
  ]
}

export const supabaseConnector: RecipeConnector = {
  kind: 'supabase',
  title: 'Supabase',
  capabilities: ['snapshot', 'drift'],
  requiredScopes: { snapshot: ['personal access token (cannot be scoped)', 'read_only MCP'] },
  credentialNote: 'Supabase personal access tokens cannot be limited to read-only. Mushi only calls the hosted Supabase MCP in read-only mode and only runs SELECT queries.',
  async probe(ctx) {
    if (typeof ctx.config.projectRef !== 'string' || !REF_RE.test(ctx.config.projectRef)) return notConnected('Link a Supabase project (its 20-character ref).')
    if (!ctx.readCredential) return notConnected('Add a Supabase access token under API keys.')
    const r = await tool(ctx, 'list_tables', { schemas: ['public'] })
    if (r.status === 401 || r.status === 403) return { ok: false, status: 'error', granted: [], missing: r.status === 403 ? ['read_only MCP'] : [], reason: statusReason('Supabase', r.status), failure: failureOfStatus(r.status) }
    if (r.error) return { ok: false, status: 'error', granted: [], missing: [], reason: r.error, ...(r.status !== 200 ? { failure: failureOfStatus(r.status) } : {}) }
    return { ok: true, status: 'connected', granted: ['personal access token (cannot be scoped)', 'read_only MCP'], missing: [] }
  },
  async snapshot(ctx) {
    if (typeof ctx.config.projectRef !== 'string' || !REF_RE.test(ctx.config.projectRef) || !ctx.readCredential) {
      throw new ConnectorError('Supabase is not connected for this project.', 'not_connected')
    }
    const tables = await tool(ctx, 'list_tables', { schemas: ['public'] })
    if (tables.error) throw new ConnectorError(`Could not read the schema: ${tables.error}`, 'error', tables.status !== 200 ? failureOfStatus(tables.status) : undefined)
    const [applied, secretRpcs, grants, buckets, fnsRes, advisorsRes] = await Promise.all([
      sql<{ version: string }>(ctx, SQL_APPLIED_MIGRATIONS),
      sql<SecretRpcRow>(ctx, SQL_SECRET_RPCS),
      sql<FunctionGrantRow>(ctx, SQL_FUNCTION_GRANTS),
      sql<BucketSizeRow>(ctx, SQL_STORAGE_SIZES),
      tool(ctx, 'list_edge_functions'),
      tool(ctx, 'get_advisors', { type: 'security' }),
    ])
    const tableList = json<Array<{ name?: string; schema?: string; rls_enabled?: boolean }>>(tables.text) ?? []
    const fns = json<Array<{ slug?: string; verify_jwt?: boolean }>>(fnsRes.text) ?? null
    return {
      observedAt: ctx.now().toISOString(),
      elements: {
        schema: { summary: { tables: tableList.length, appliedMigrations: applied?.length ?? null } },
      },
      resources: [{ kind: 'supabase_project', externalId: String(ctx.config.projectRef), role: 'database' }],
      facts: {
        tables: tableList.map((t) => ({ name: t.name ?? null, rls: t.rls_enabled ?? null })),
        appliedVersions: applied ? applied.map((a) => String(a.version)) : null,
        secretRpcs: secretRpcs,
        functionGrants: grants,
        buckets,
        functions: fns ? fns.map((f) => ({ slug: String(f.slug ?? ''), verifyJwt: typeof f.verify_jwt === 'boolean' ? f.verify_jwt : null, source: null })) : null,
        advisors: json<unknown>(advisorsRes.text),
        // Not readable through the read-only MCP: stays null, so the detector says unknown.
        billedStorageBytes: null,
        pitrEnabled: null,
      },
    }
  },
  detectDrift(_prev, next) {
    const f = next.facts as Record<string, any>
    const out: DriftFinding[] = []
    // Declared-vs-applied migrations need the repo's file list, so recipe-phase2 joins
    // this connector's appliedVersions with the GitHub connector's migrationFiles.
    const radar = supabaseRadarResults(f)
    for (const r of radar) {
      for (const x of r.findings) out.push({ gate: 'portfolio_radar', ruleId: x.ruleId, severity: x.severity, message: x.message, filePath: x.filePath ?? null, suggestedFix: { kind: 'prompt', text: x.fix } })
    }
    return out
  },
}
