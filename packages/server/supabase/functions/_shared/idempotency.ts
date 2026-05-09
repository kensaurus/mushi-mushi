/**
 * FILE: packages/server/supabase/functions/_shared/idempotency.ts
 * PURPOSE: IETF-draft Idempotency-Key middleware for Mushi mutation endpoints.
 *
 * Contract:
 *   - Client sends `Idempotency-Key: <uuid>` header on POST requests.
 *   - First request: runs handler, stores (user_id, key, request_hash, response).
 *   - Retry with SAME key + SAME body: replays stored response with
 *     `Idempotency-Replayed: true` header — no side effects.
 *   - Retry with SAME key + DIFFERENT body: returns 409 IDEMPOTENCY_KEY_REUSED.
 *   - No header: passes through unchanged — every client is backward-compatible.
 *
 * Tenancy model (post 2026-05-09 hardening):
 *   The cache key is `(user_id, key)` where `user_id` is set by the auth
 *   middleware that runs BEFORE this wrapper (`adminOrApiKey` or `jwtAuth`).
 *   We do NOT trust a `projectId` from the request body for cache scoping —
 *   that would let a malicious authenticated user spoof projectId=P_A
 *   (project they don't own), trigger a handler 403, and seed `(P_A, key)`
 *   with the 403 response. The legitimate owner of P_A would then be DoS'd
 *   on their next retry. By keying on the AUTH-VERIFIED user_id, B's
 *   pollution lands in B's own namespace and never affects A.
 *   `project_id` is still recorded on the row for audit/cleanup but does
 *   not participate in the cache lookup.
 *
 * Body cap:
 *   Requests larger than `MAX_REQUEST_BODY_BYTES` (1 MiB) bypass the cache —
 *   hashing huge bodies wastes Edge runtime memory and the legitimate
 *   mutation endpoints all carry small JSON payloads. The handler still runs.
 *
 * Cacheable responses:
 *   Only `application/json` 2xx and 4xx responses are cached. SSE,
 *   text/markdown, octet-stream, and 5xx responses bypass — replaying a
 *   parsed-as-JSON SSE stream would corrupt the response.
 *
 * Usage:
 *   import { withIdempotency } from '../../_shared/idempotency.ts'
 *
 *   app.post('/v1/admin/fixes/dispatch', adminOrApiKey({...}), async (c) => {
 *     return withIdempotency(c, async () => {
 *       // ... handler body ...
 *       return c.json({ ok: true, data: job }, 201)
 *     })
 *   })
 *
 * Idempotency-Key values MUST be UUIDs (RFC 4122). Non-UUID keys are
 * accepted but not validated — the client is responsible for uniqueness.
 *
 * TTL: stored responses are purged after 24h by the pg_cron job
 * `mushi-idempotency-cleanup` (installed by migration 20260509200001).
 */

import type { Context } from 'npm:hono@4'
import { getServiceClient } from './db.ts'

/** 1 MiB — anything larger bypasses the cache (legitimate Mushi mutations
 * carry kilobytes, not megabytes). Tuned to fit comfortably in Edge runtime
 * memory while still hashing a typical fix-dispatch payload (~2 KB) in <1ms. */
const MAX_REQUEST_BODY_BYTES = 1024 * 1024

/** SHA-256 of a string, returned as lowercase hex */
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Wrap a mutation handler with idempotency semantics.
 *
 * Returns the handler's response on first call; replays the stored response
 * (with `Idempotency-Replayed: true`) on subsequent calls with the same key
 * and identical body. Returns 409 if the key is reused with a different body.
 *
 * When `Idempotency-Key` is absent, when `c.get('userId')` is unset (no
 * auth context — should never happen because every route this wraps has
 * auth in front), or when the request body exceeds 1 MiB, the handler is
 * called directly with no cache interaction.
 *
 * @param c     The Hono context. MUST have `c.get('userId')` set by auth
 *              middleware (either `jwtAuth` or `adminOrApiKey`).
 * @param handler The async handler to call. Its response is stored on first
 *                call and replayed on retries.
 */
export async function withIdempotency(
  c: Context,
  handler: () => Promise<Response>,
): Promise<Response> {
  const idempotencyKey = c.req.header('Idempotency-Key')
  if (!idempotencyKey) {
    return handler()
  }

  // Tenancy boundary: ALWAYS use the auth-verified user_id. Never trust
  // a body-supplied projectId for cache scoping (see file header comment).
  const userId = c.get('userId') as string | undefined
  if (!userId) {
    // No auth context — bypass cache. The handler itself will likely 401.
    // We don't bail here so that auth's own error response is what the
    // client sees, not an idempotency-shaped error.
    return handler()
  }

  // Read the body once for hashing + projectId extraction. The body stream
  // can only be consumed once; we re-inject it via c.req.raw so the handler
  // sees it.
  const rawBody = await c.req.text()

  // Body-size guard: SHA-256 + JSON.parse over a 100 MB body would blow
  // through Edge runtime memory. Bypass cache for oversized requests.
  if (rawBody.length > MAX_REQUEST_BODY_BYTES) {
    rebindBody(c, rawBody)
    return handler()
  }

  const requestHash = await sha256hex(rawBody)

  // projectId is still extracted (best-effort) for audit-only storage on
  // the row. It is NOT part of the cache key.
  let projectId = (c.get('projectId') as string | undefined) ?? ''
  if (!projectId && rawBody) {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>
      const fromBody = parsed?.projectId ?? parsed?.project_id
      if (typeof fromBody === 'string') projectId = fromBody
    } catch {
      // Body isn't JSON — leave projectId empty.
    }
  }

  const db = getServiceClient()

  // Lookup is keyed on (user_id, key) only — project_id never participates.
  const { data: existing } = await db
    .from('request_idempotency')
    .select('request_hash, response_status, response_body')
    .eq('user_id', userId)
    .eq('key', idempotencyKey)
    .maybeSingle()

  if (existing) {
    if (existing.request_hash !== requestHash) {
      return Response.json(
        {
          ok: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED',
            message:
              'The Idempotency-Key was previously used with a different request body. ' +
              'Generate a new key for a different request.',
          },
        },
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
    return Response.json(existing.response_body, {
      status: existing.response_status,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Replayed': 'true',
      },
    })
  }

  rebindBody(c, rawBody)
  const response = await handler()

  // Cache only JSON 2xx/4xx responses. Skip SSE, text/markdown, binary
  // (replaying parsed-as-JSON would corrupt those) and 5xx (transient,
  // should be retried fresh).
  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')
  const cacheable = isJson && response.status < 500

  if (cacheable) {
    let responseBody: unknown
    try {
      responseBody = await response.clone().json()
    } catch {
      // Body claimed JSON but didn't parse — don't cache, return as-is.
      return response
    }

    // We need a project_id (NOT NULL) to insert. If we couldn't resolve one
    // (purely user-scoped admin endpoint), skip the store rather than fail.
    if (!projectId) {
      return response
    }

    // Best-effort store; failure must NOT block the response. Supabase JS
    // returns a builder that resolves to { data, error } — wrap in try/catch
    // for any thrown network error.
    try {
      const { error: storeErr } = await db
        .from('request_idempotency')
        .upsert(
          {
            user_id: userId,
            key: idempotencyKey,
            project_id: projectId,
            request_hash: requestHash,
            response_status: response.status,
            response_body: responseBody,
          },
          { onConflict: 'user_id,key', ignoreDuplicates: false },
        )
      if (storeErr) {
        console.warn('[idempotency] store failed (non-fatal):', storeErr.message)
      }
    } catch (err) {
      console.warn(
        '[idempotency] store threw (non-fatal):',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return response
}

/** Re-inject a consumed body onto `c.req.raw` so downstream `c.req.json()`
 * sees the original payload. Hono's Context doesn't expose a public
 * mutation API, hence the unsafe-but-narrow cast. */
function rebindBody(c: Context, rawBody: string): void {
  const patched = new Request(c.req.url, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: rawBody,
  })
  ;(c.req as unknown as { raw: Request }).raw = patched
}
