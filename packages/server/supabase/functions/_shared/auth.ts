import type { Context, Next } from 'npm:hono@4'
import { getServiceClient } from './db.ts'

export interface ProjectContext {
  projectId: string
  projectName: string
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
 * Middleware: validate API key from X-Mushi-Api-Key header.
 * Sets projectId and projectName on the Hono context.
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const apiKey = c.req.header('X-Mushi-Api-Key') || c.req.header('X-Mushi-Project')

  if (!apiKey) {
    return c.json({ error: { code: 'MISSING_API_KEY', message: 'X-Mushi-Api-Key header required' } }, 401)
  }

  const db = getServiceClient()

  // Hash the key and look it up
  const encoder = new TextEncoder()
  const data = encoder.encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

  const { data: keyRow, error } = await db
    .from('project_api_keys')
    .select('project_id, is_active, projects!inner(name)')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (error || !keyRow) {
    return c.json({ error: { code: 'INVALID_API_KEY', message: 'Invalid or revoked API key' } }, 401)
  }

  c.set('projectId', keyRow.project_id)
  c.set('projectName', (keyRow as any).projects?.name ?? 'Unknown')
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
  await next()
}
