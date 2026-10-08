/**
 * FILE: packages/server/supabase/functions/_shared/connectors/supabase.ts
 * PURPOSE: The Supabase connector (Plan 019 §2b): legacy-backed — the BYOK
 *          `supabase` PAT and `project_settings.supabase_project_ref`.
 *          The console asks for a scoped PAT (one project; Database, Edge
 *          Functions, Advisors and Logs at Read). A classic PAT carries the
 *          owner's full account, so Mushi still calls ONLY the hosted
 *          Supabase MCP with `read_only=true` and runs only SELECTs.
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
import { SUPABASE_PROJECT_REF_RE as REF_RE } from '../supabase-project-ref.ts'
import { ConnectorError, notConnected, type ConnectorContext, type DriftFinding, type RecipeConnector } from './types.ts'
import { mcpCallTool } from '../mcp-http-session.ts'
import { normalizeMcpEdgeFunctions, normalizeMcpTables, unwrapUntrusted } from '../supabase-mcp-client.ts'

const MCP_URL = 'https://mcp.supabase.com/mcp'

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
  // Streamable HTTP with a session: a bare tools/call is now refused with 400
  // "Mcp-Session-Id header is required" (mcp-http-session.ts).
  const r = await mcpCallTool(
    { url, token: String(ctx.readCredential), fetchImpl: (u, init) => ctx.fetch(u, init), timeoutMs: 20_000 },
    name,
    args,
  )
  if (r.status !== 200) return { status: r.status, text: null, error: statusReason('Supabase', r.status) }
  if (r.error || !r.result) return { status: 200, text: null, error: r.error ?? 'Supabase MCP returned no result' }
  const text = r.result.content?.[0]?.text ?? null
  if (r.result.isError) return { status: 200, text: null, error: (text ?? 'tool error').slice(0, 200) }
  return { status: 200, text, error: null }
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
  requiredScopes: { snapshot: ['scoped access token: Database, Edge Functions, Advisors, Logs (Read)', 'read_only MCP'] },
  credentialNote: 'Use a scoped Supabase access token: this one project only, with Database, Edge Functions, Advisors and Logs set to Read, and an expiry. Mushi only calls the hosted Supabase MCP in read-only mode and only runs SELECT queries.',
  async probe(ctx) {
    if (typeof ctx.config.projectRef !== 'string' || !REF_RE.test(ctx.config.projectRef)) return notConnected('Link a Supabase project (its 20-character ref).')
    if (!ctx.readCredential) return notConnected('Add a Supabase access token under API keys.')
    const r = await tool(ctx, 'list_tables', { schemas: ['public'] })
    if (r.status === 401 || r.status === 403) return { ok: false, status: 'error', granted: [], missing: r.status === 403 ? ['read_only MCP'] : [], reason: statusReason('Supabase', r.status), failure: failureOfStatus(r.status) }
    if (r.error) return { ok: false, status: 'error', granted: [], missing: [], reason: r.error, ...(r.status !== 200 ? { failure: failureOfStatus(r.status) } : {}) }
    return { ok: true, status: 'connected', granted: ['Database (Read)', 'read_only MCP'], missing: [] }
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
    // `{ tables: [...] }` today; a bare array before. `.length` on the object read 0.
    const tableList = normalizeMcpTables(json<unknown>(tables.text) ?? unwrapUntrusted(tables.text))
    // `{ functions: [...] }` today; a bare array before. `.map` on the object
    // threw and errored every Supabase radar rule (2026-10-05).
    const fns = fnsRes.text == null ? null : normalizeMcpEdgeFunctions(json<unknown>(fnsRes.text) ?? fnsRes.text)
    return {
      observedAt: ctx.now().toISOString(),
      elements: {
        schema: { summary: { tables: tableList.length, appliedMigrations: applied?.length ?? null } },
      },
      resources: [{ kind: 'supabase_project', externalId: String(ctx.config.projectRef), role: 'database' }],
      facts: {
        tables: tableList.map((t) => ({ name: t.name || null, rls: t.rls_enabled })),
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
