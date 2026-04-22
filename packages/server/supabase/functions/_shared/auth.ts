import type { Context, Next } from 'npm:hono@4'
import { getServiceClient } from './db.ts'

export interface ProjectContext {
  projectId: string
  projectName: string
}

/**
 * Shape of a `project_api_keys` row joined with `projects!inner(name)`.
 * Declared locally so we don't have to thread the generated Supabase types
 * into every Edge Function just for this one query.
 */
interface ApiKeyRow {
  project_id: string
  is_active: boolean
  scopes: string[] | null
  owner_user_id: string | null
  projects: { name: string } | null
}

/**
 * Constant-time string equality.
 *
 * Classic `a === b` short-circuits on the first mismatched byte and leaks a
 * measurable timing side-channel under load — attackers with a few thousand
 * requests can infer correct-prefix-length. Deno ships a Web Crypto runtime
 * but no built-in `timingSafeEqual`, so we use a simple XOR-reduce over
 * same-length byte arrays. Lengths are always compared via the same shape.
 *
 * Exported so other Edge Functions (webhook HMAC verifiers, API key
 * comparisons) can share a single hardened primitive.
 */
export function timingSafeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  // Always walk a fixed-length buffer so attackers can't use length-mismatch
  // early returns as a timing channel. We XOR a sentinel diff on length drift.
  const len = Math.max(aBytes.length, bBytes.length)
  let diff = aBytes.length ^ bBytes.length
  for (let i = 0; i < len; i++) {
    const ai = aBytes[i] ?? 0
    const bi = bBytes[i] ?? 0
    diff |= ai ^ bi
  }
  return diff === 0
}

/**
 * Gate an Edge Function handler to trusted internal callers.
 *
 * Why this exists: Supabase Edge Functions with `verify_jwt = false` are
 * publicly reachable by default. Functions like `fast-filter`,
 * `classify-report`, and `fix-worker` are meant for *internal* server-to-server
 * calls (from the `api` function and cron jobs) but used to have no auth
 * check of their own — making it trivial to burn LLM budget or trigger
 * fix-worker PR creation from outside.
 *
 * Accepted credentials (either one is sufficient):
 *   1. `MUSHI_INTERNAL_CALLER_SECRET` — a non-reserved shared secret we
 *      control, used by Postgres cron jobs (pg_net) that can't read the
 *      runtime-injected `SUPABASE_SERVICE_ROLE_KEY`. The Supabase CLI
 *      refuses to set secrets whose name starts with `SUPABASE_`, so
 *      cron can never know the exact value of the auto-injected key.
 *      A dedicated shared secret sidesteps that constraint entirely.
 *   2. `SUPABASE_SERVICE_ROLE_KEY` — still accepted for callers that run
 *      *inside* the edge runtime (e.g. `api` calling `fix-worker`), where
 *      the env var is auto-injected and guaranteed to match.
 *
 * The check uses constant-time string equality on stable header values and
 * returns a generic 401 so scanners can't distinguish "env missing" from
 * "token mismatched".
 *
 * @returns null when authorized; Response (401) when not — caller returns it.
 */
export function requireServiceRoleAuth(req: Request): Response | null {
  const internalSecret = Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!internalSecret && !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: { code: 'SERVER_MISCONFIGURED', message: 'No internal auth configured' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  if (!token) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Requires valid internal caller token' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const matches =
    (internalSecret !== undefined && timingSafeEqual(token, internalSecret)) ||
    (serviceRoleKey !== undefined && timingSafeEqual(token, serviceRoleKey))

  if (!matches) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Requires valid internal caller token' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }
  return null
}

/**
 * SHA-256 of a raw API key, lowercase hex — matches how keys are persisted
 * in `project_api_keys.key_hash`. Extracted so `apiKeyAuth` and
 * `adminOrApiKey` stay byte-compatible with the hash at rest.
 */
async function hashApiKey(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Middleware: validate API key from X-Mushi-Api-Key header.
 * Sets projectId and projectName on the Hono context.
 *
 * Used for SDK ingestion paths (report submission, notifications). Callers
 * that need admin semantics should use {@link adminOrApiKey} instead — it
 * accepts either an API key OR a user JWT and enforces scope.
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const apiKey = c.req.header('X-Mushi-Api-Key') || c.req.header('X-Mushi-Project')

  if (!apiKey) {
    return c.json({ error: { code: 'MISSING_API_KEY', message: 'X-Mushi-Api-Key header required' } }, 401)
  }

  const db = getServiceClient()
  const keyHash = await hashApiKey(apiKey)

  const { data, error } = await db
    .from('project_api_keys')
    .select('project_id, is_active, scopes, projects!inner(name)')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  const keyRow = data as Pick<ApiKeyRow, 'project_id' | 'is_active' | 'scopes' | 'projects'> | null
  if (error || !keyRow) {
    return c.json({ error: { code: 'INVALID_API_KEY', message: 'Invalid or revoked API key' } }, 401)
  }

  c.set('projectId', keyRow.project_id)
  c.set('projectName', keyRow.projects?.name ?? 'Unknown')
  c.set('apiKeyScopes', keyRow.scopes ?? [])
  await next()
}

/**
 * Middleware: validate Supabase JWT for admin endpoints.
 * Requires authenticated user.
 */
export async function jwtAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'MISSING_AUTH', message: 'Authorization Bearer token required' } }, 401)
  }

  const db = getServiceClient()
  const token = authHeader.replace('Bearer ', '')

  const { data: { user }, error } = await db.auth.getUser(token)

  if (error || !user) {
    return c.json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired auth token' } }, 401)
  }

  c.set('userId', user.id)
  c.set('userEmail', user.email)
  c.set('authMethod', 'jwt')
  await next()
}

/** Scope required for a route. mcp:write implies mcp:read. */
export type McpScope = 'mcp:read' | 'mcp:write'

interface AdminOrApiKeyOptions {
  /**
   * Scope the API-key caller must hold. JWT callers bypass this check (they
   * are the project owner — scopes only matter for delegated, rotatable
   * credentials). Defaults to 'mcp:read' — read-only admin endpoints.
   */
  scope?: McpScope
}

/**
 * Middleware: accept either a Supabase user JWT OR a project API key with
 * the required MCP scope. Sets the Hono `userId` context slot either way,
 * so existing admin handlers (which query `projects.owner_id = userId`)
 * work unchanged.
 *
 * Decision rationale:
 *   - API-key auth takes precedence when `X-Mushi-Api-Key` is present so
 *     MCP clients don't have to omit their always-set `Authorization` header.
 *   - For API-key auth we set `userId` to the key's project owner; for JWT
 *     auth it's the authenticated user. Either resolves to the same
 *     `owner_id` projection in admin queries.
 *   - We set `authMethod` so audit logs can distinguish a human console
 *     click from an MCP-issued action.
 *   - Scope implication (`mcp:write` grants `mcp:read`) is handled in SQL
 *     (`api_key_has_scope`) and mirrored here for fast-path checks.
 */
export function adminOrApiKey(options: AdminOrApiKeyOptions = {}) {
  const requiredScope: McpScope = options.scope ?? 'mcp:read'

  return async function middleware(c: Context, next: Next) {
    const apiKey = c.req.header('X-Mushi-Api-Key')
    if (apiKey) {
      const db = getServiceClient()
      const keyHash = await hashApiKey(apiKey)

      const { data, error } = await db
        .from('project_api_keys')
        .select('project_id, is_active, scopes, owner_user_id, projects!inner(name)')
        .eq('key_hash', keyHash)
        .eq('is_active', true)
        .single()

      const keyRow = data as ApiKeyRow | null
      if (error || !keyRow) {
        return c.json({ error: { code: 'INVALID_API_KEY', message: 'Invalid or revoked API key' } }, 401)
      }

      const scopes = keyRow.scopes ?? []
      const grants = scopes.includes(requiredScope) ||
        (requiredScope === 'mcp:read' && scopes.includes('mcp:write'))
      if (!grants) {
        return c.json(
          {
            error: {
              code: 'INSUFFICIENT_SCOPE',
              message: `API key is missing required scope "${requiredScope}". Mint a new key with the correct scope or upgrade this one in the admin console.`,
            },
          },
          403,
        )
      }

      const ownerId = keyRow.owner_user_id
      if (!ownerId) {
        // The denorm trigger runs on insert/update; a NULL here means a row
        // predates the scope migration and was not backfilled. Fail closed —
        // we can't safely scope queries without an owner id.
        return c.json(
          {
            error: {
              code: 'KEY_NOT_MIGRATED',
              message: 'API key is missing owner metadata. Rotate the key to regenerate it.',
            },
          },
          401,
        )
      }

      c.set('userId', ownerId)
      c.set('projectId', keyRow.project_id)
      c.set('projectName', keyRow.projects?.name ?? 'Unknown')
      c.set('apiKeyScopes', scopes)
      c.set('authMethod', 'apiKey')
      await next()
      return
    }

    // Fall through to JWT — keeps existing console flows unchanged.
    await jwtAuth(c, next)
  }
}
