/**
 * FILE: packages/server/supabase/functions/api/routes/kensaurus-ops.ts
 * PURPOSE: The console's "Providers & AI routes" page (operator only) reads
 *          and changes the shared AI provider accounts and model routes
 *          through kensaurus-ops, the operator API on the kenji project
 *          (yen-yen docs/kensaurus-provider-watch.md, "Operator console API").
 *
 *   GET  /v1/admin/kensaurus/ops[?fresh=1]
 *        → { ok, data: { meta, snapshot, fetched_at, cached } }
 *        The snapshot is held for 60 s per isolate; ?fresh=1 skips the hold.
 *   POST /v1/admin/kensaurus/ops   { action, …fields }
 *        → { ok, data: { action, result } }
 *        `actor` is always `console:<user id>` from the JWT; a client actor
 *        is dropped. A write clears the held snapshot.
 *
 * Errors use the console envelope `{ ok:false, error:{ code, message, issues? } }`
 * with upstream's status, so the page can tell 409 last_default_route and
 * 422 unpriced_model apart. Upstream's `error` becomes `code`, its `message`
 * the message and its `details` (validation_failed) `issues`. Upstream 401
 * becomes 502 upstream_auth, 503 stays 503 not_configured, a timeout or
 * network failure is 502 upstream_unreachable.
 *
 * Unset KENSAURUS_OPS_URL or KENSAURUS_OPS_CONSOLE_TOKEN → 404: a self-hosted
 * install exposes nothing. The token goes only in the upstream header; it is
 * never logged or returned. Runs in api-ext (api forwards the path).
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { requireOperator } from '../../_shared/operator-gate.ts'

const TOKEN_HEADER = 'x-kensaurus-ops-token'
const CACHE_TTL_MS = 60_000
const TIMEOUT_MS = 10_000
/** Upstream refuses a body over 16 KB (MAX_OPS_BODY_BYTES). */
const MAX_BODY_BYTES = 16 * 1024

/** The writes upstream accepts (OPS_META.actions). Anything else is refused here. */
const ACTIONS = new Set([
  'upsert_route',
  'enable_route',
  'disable_route',
  'delete_route',
  'reorder',
  'set_provider_enabled',
  'set_provider_thresholds',
])

type Ctx = Context<{ Variables: Variables }>

export interface KensaurusOpsDeps {
  jwtAuth: MiddlewareHandler
  /** Returns a 403 Response for a non-operator, null otherwise. */
  requireOperator: (c: Ctx) => Response | null
  /** Read at request time, never at module load. */
  env: (name: string) => string | undefined
  fetchImpl: typeof fetch
  now: () => number
}

export const defaultKensaurusOpsDeps: KensaurusOpsDeps = {
  jwtAuth: jwtAuth as MiddlewareHandler,
  requireOperator: (c) => requireOperator(c as never),
  env: (name) => Deno.env.get(name),
  fetchImpl: (input, init) => fetch(input, init),
  now: () => Date.now(),
}

function fail(c: Ctx, status: number, code: string, message: string, issues?: string[]): Response {
  return c.json({ ok: false, error: { code, message, ...(issues ? { issues } : {}) } }, status as never)
}

/** Upstream's `{ error, message?, details? }` as the console envelope, status kept. */
function mapUpstreamError(c: Ctx, status: number, body: unknown): Response {
  if (status === 401 || status === 403) return fail(c, 502, 'upstream_auth', 'The provider API refused the console token.')
  if (status === 503) return fail(c, 503, 'not_configured', 'The provider API is not configured yet.')
  const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; message?: unknown; details?: unknown }
  const code = typeof b.error === 'string' && /^[a-z_]{1,40}$/.test(b.error) ? b.error : 'upstream_error'
  const message = typeof b.message === 'string' && b.message ? b.message.slice(0, 300) : code
  const issues = Array.isArray(b.details)
    ? b.details.filter((d): d is string => typeof d === 'string').slice(0, 20).map((d) => d.slice(0, 200))
    : undefined
  const passStatus = status >= 400 && status < 600 ? status : 502
  return fail(c, passStatus, code, message, issues)
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export function registerKensaurusOpsRoutes(
  app: Hono<{ Variables: Variables }>,
  deps: KensaurusOpsDeps = defaultKensaurusOpsDeps,
): void {
  // One held snapshot per isolate (per registered app, so tests start clean).
  let held: { at: number; body: { meta: unknown; snapshot: unknown } } | null = null

  const config = () => {
    const url = deps.env('KENSAURUS_OPS_URL')?.trim()
    const token = deps.env('KENSAURUS_OPS_CONSOLE_TOKEN')?.trim()
    return url && token && /^https:\/\//i.test(url) ? { url, token } : null
  }

  const call = async (
    cfg: { url: string; token: string },
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<Response | 'unreachable'> => {
    try {
      return await deps.fetchImpl(cfg.url, {
        method: init.method,
        headers: {
          [TOKEN_HEADER]: cfg.token,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      // The error's name only: a message could quote the request.
      log.warn('kensaurus-ops unreachable', { scope: 'kensaurus-ops', method: init.method, error: err instanceof Error ? err.name : 'unknown' })
      return 'unreachable'
    }
  }

  app.get('/v1/admin/kensaurus/ops', deps.jwtAuth, async (c) => {
    const cfg = config()
    if (!cfg) return fail(c as Ctx, 404, 'NOT_FOUND', 'No such route.')
    const denied = deps.requireOperator(c as Ctx)
    if (denied) return denied

    const now = deps.now()
    const fresh = c.req.query('fresh') === '1'
    if (!fresh && held && now - held.at < CACHE_TTL_MS) {
      return c.json({ ok: true, data: { ...held.body, fetched_at: new Date(held.at).toISOString(), cached: true } })
    }
    const res = await call(cfg, { method: 'GET' })
    if (res === 'unreachable') return fail(c as Ctx, 502, 'upstream_unreachable', 'The provider API did not answer in time.')
    const body = await readJson(res)
    if (!res.ok) {
      log.warn('kensaurus-ops read failed', { scope: 'kensaurus-ops', status: res.status })
      return mapUpstreamError(c as Ctx, res.status, body)
    }
    const b = (body ?? {}) as { meta?: unknown; snapshot?: unknown }
    if (!b.snapshot || typeof b.snapshot !== 'object') {
      return fail(c as Ctx, 502, 'upstream_invalid', 'The provider API sent no snapshot.')
    }
    held = { at: now, body: { meta: b.meta ?? null, snapshot: b.snapshot } }
    return c.json({ ok: true, data: { ...held.body, fetched_at: new Date(now).toISOString(), cached: false } })
  })

  app.post('/v1/admin/kensaurus/ops', deps.jwtAuth, async (c) => {
    const cfg = config()
    if (!cfg) return fail(c as Ctx, 404, 'NOT_FOUND', 'No such route.')
    const denied = deps.requireOperator(c as Ctx)
    if (denied) return denied

    const raw = await c.req.text()
    if (raw.length > MAX_BODY_BYTES) return fail(c as Ctx, 413, 'body_too_large', 'The change is over 16 KB.')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return fail(c as Ctx, 400, 'invalid_json', 'The body is not JSON.')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail(c as Ctx, 400, 'validation_failed', 'The body must be a JSON object.', ['(body): invalid_type'])
    }
    const { actor: _clientActor, ...fields } = parsed as Record<string, unknown>
    const action = fields.action
    if (typeof action !== 'string' || !ACTIONS.has(action)) {
      return fail(c as Ctx, 400, 'validation_failed', 'Unknown action.', ['action: invalid_enum_value'])
    }
    const userId = c.get('userId') as string
    const outgoing = JSON.stringify({ ...fields, actor: `console:${userId}` })
    if (new TextEncoder().encode(outgoing).length > MAX_BODY_BYTES) {
      return fail(c as Ctx, 413, 'body_too_large', 'The change is over 16 KB.')
    }

    const res = await call(cfg, { method: 'POST', body: outgoing })
    if (res === 'unreachable') return fail(c as Ctx, 502, 'upstream_unreachable', 'The provider API did not answer in time.')
    const body = await readJson(res)
    if (!res.ok) {
      log.warn('kensaurus-ops write refused', { scope: 'kensaurus-ops', action, status: res.status })
      return mapUpstreamError(c as Ctx, res.status, body)
    }
    held = null
    const b = (body ?? {}) as { action?: unknown; result?: unknown }
    return c.json({ ok: true, data: { action: typeof b.action === 'string' ? b.action : action, result: b.result ?? null } })
  })
}
