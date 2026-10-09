// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/api/routes/push.ts
 * PURPOSE: Developer Web Push for the installed admin PWA (plan
 *          docs/execplans/dead-code-voice-agent-loop.md, C5 "Developer Web
 *          Push is a new surface"). The console subscribes a device from a
 *          tap, stores the PushSubscription here, and the voice return path
 *          (`_shared/voice-return.ts`) fans fix events out through
 *          `_shared/web-push.ts sendWebPushToUser()`.
 *
 *   GET    /v1/push/vapid-public-key   public   → { ok, publicKey }
 *                                               503 SERVER_MISCONFIGURED when VAPID_* unset
 *   POST   /v1/push/subscriptions      jwtAuth  body { endpoint, keys: { p256dh, auth },
 *                                               user_agent?, project_id? } → upsert on (user, endpoint)
 *   DELETE /v1/push/subscriptions      jwtAuth  body { endpoint } → { ok, removed }
 *   POST   /v1/push/test               jwtAuth  → { ok, sent, failed } (5 / min / user)
 *
 * SSRF: the endpoint host is allow-listed (`isAllowedPushEndpoint`) before it
 * is stored, and again in the sender before any fetch.
 *
 * Tests: packages/server/src/__tests__/push-routes.test.ts drive the handlers
 * through a fake Hono app with injected deps (`PushRouteDeps`).
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { log as rootLog } from '../../_shared/logger.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { jsonError } from '../shared.ts'
import {
  base64UrlDecode,
  getVapidConfig,
  isAllowedPushEndpoint,
  sendWebPushToUser,
  type WebPushFanoutResult,
  type WebPushPayload,
} from '../../_shared/web-push.ts'

const log = rootLog.child('push')

// ── Body validation ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Shape of `PushSubscription.toJSON()` plus our optional context fields.
 * `expirationTime` is what browsers include; it is accepted and ignored.
 */
const subscriptionBodySchema = z.object({
  endpoint: z.string().trim().min(1).max(2048),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(200),
    auth: z.string().trim().min(1).max(64),
  }),
  expirationTime: z.number().nullable().optional(),
  user_agent: z.string().max(512).nullable().optional(),
  project_id: z.string().regex(UUID_RE, 'project_id must be a UUID').nullable().optional(),
})

export interface ParsedPushSubscription {
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  project_id: string | null
}

export type ParsePushSubscriptionResult =
  | { ok: true; value: ParsedPushSubscription }
  | { ok: false; code: 'VALIDATION_ERROR'; message: string }

function decodedLength(b64url: string): number | null {
  try {
    return base64UrlDecode(b64url).length
  } catch {
    return null
  }
}

/** Pure validator so the allow-list and key-length rules are unit-testable. */
export function parsePushSubscriptionBody(body: unknown): ParsePushSubscriptionResult {
  const parsed = subscriptionBodySchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
    return { ok: false, code: 'VALIDATION_ERROR', message: `${path}${issue?.message ?? 'invalid body'}` }
  }
  const { endpoint, keys, user_agent, project_id } = parsed.data
  if (!isAllowedPushEndpoint(endpoint)) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message:
        'endpoint: host is not a supported push service (fcm.googleapis.com, *.push.services.mozilla.com, *.push.apple.com, *.notify.windows.com)',
    }
  }
  const p256dhLen = decodedLength(keys.p256dh)
  if (p256dhLen !== 65 || base64UrlDecode(keys.p256dh)[0] !== 0x04) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'keys.p256dh: expected a base64url 65-byte P-256 point' }
  }
  if (decodedLength(keys.auth) !== 16) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'keys.auth: expected a base64url 16-byte secret' }
  }
  return {
    ok: true,
    value: {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: user_agent ? user_agent.slice(0, 512) : null,
      project_id: project_id ?? null,
    },
  }
}

const deleteBodySchema = z.object({ endpoint: z.string().trim().min(1).max(2048) })

// ── Route registration ───────────────────────────────────────────────────────

export interface PushRouteDeps {
  getServiceClient: typeof getServiceClient
  jwtAuth: MiddlewareHandler
  getVapidConfig: typeof getVapidConfig
  sendWebPushToUser: (
    db: ReturnType<typeof getServiceClient>,
    userId: string,
    payload: WebPushPayload,
  ) => Promise<WebPushFanoutResult>
  claimTenantRateLimit: typeof claimTenantRateLimit
}

const defaultDeps: PushRouteDeps = {
  getServiceClient,
  jwtAuth: jwtAuth as unknown as MiddlewareHandler,
  getVapidConfig,
  sendWebPushToUser: (db, userId, payload) => sendWebPushToUser(db, userId, payload),
  claimTenantRateLimit,
}

/** Per-user ceiling on POST /v1/push/test — a test ping is a manual action. */
const TEST_PUSH_LIMIT = 5
const TEST_PUSH_WINDOW_SEC = 60

async function readJson(c: Context): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await c.req.json() }
  } catch {
    return { ok: false, response: jsonError(c, 'INVALID_JSON', 'Body must be a JSON object', 400) }
  }
}

export function registerPushRoutes(
  app: Hono<{ Variables: Variables }>,
  deps: PushRouteDeps = defaultDeps,
): void {
  // Public: the browser needs the applicationServerKey before it can subscribe.
  // The key is not a secret (it is embedded in every subscription anyway).
  app.get('/v1/push/vapid-public-key', (c) => {
    const cfg = deps.getVapidConfig()
    if (!cfg) {
      return jsonError(c, 'SERVER_MISCONFIGURED', 'push_not_configured', 503, { reason: 'push_not_configured' })
    }
    c.header('Cache-Control', 'public, max-age=3600')
    return c.json({ ok: true, publicKey: cfg.publicKey })
  })

  app.post('/v1/push/subscriptions', deps.jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const read = await readJson(c)
    if (!read.ok) return read.response
    const parsed = parsePushSubscriptionBody(read.body)
    if (!parsed.ok) return jsonError(c, parsed.code, parsed.message, 400)

    const db = deps.getServiceClient()
    const { data, error } = await db
      .from('user_push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: parsed.value.endpoint,
          p256dh: parsed.value.p256dh,
          auth: parsed.value.auth,
          user_agent: parsed.value.user_agent,
          project_id: parsed.value.project_id,
        },
        { onConflict: 'user_id,endpoint' },
      )
      .select('id, endpoint, created_at')
      .maybeSingle()
    if (error) {
      log.error('subscription_upsert_failed', { userId, err: error.message })
      return jsonError(c, 'DB_ERROR', 'Could not store the push subscription', 500)
    }
    const row = (data ?? {}) as { id?: string; endpoint?: string; created_at?: string }
    log.info('subscription_saved', { userId, host: new URL(parsed.value.endpoint).hostname })
    return c.json({
      ok: true,
      subscription: {
        id: row.id ?? null,
        endpoint: row.endpoint ?? parsed.value.endpoint,
        created_at: row.created_at ?? null,
      },
    })
  })

  app.delete('/v1/push/subscriptions', deps.jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const read = await readJson(c)
    if (!read.ok) return read.response
    const parsed = deleteBodySchema.safeParse(read.body)
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', 'endpoint is required', 400)

    const db = deps.getServiceClient()
    const { data, error } = await db
      .from('user_push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', parsed.data.endpoint)
      .select('id')
    if (error) {
      log.error('subscription_delete_failed', { userId, err: error.message })
      return jsonError(c, 'DB_ERROR', 'Could not remove the push subscription', 500)
    }
    return c.json({ ok: true, removed: Array.isArray(data) ? data.length : 0 })
  })

  app.post('/v1/push/test', deps.jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = deps.getServiceClient()

    const gate = await deps.claimTenantRateLimit(db, `user:${userId}:push_test`, TEST_PUSH_LIMIT, TEST_PUSH_WINDOW_SEC)
    if (!gate.allowed) {
      c.header('Retry-After', String(gate.retryAfterSec ?? TEST_PUSH_WINDOW_SEC))
      return jsonError(c, 'RATE_LIMITED', 'Too many test notifications — try again in a minute', 429, {
        retry_after_sec: gate.retryAfterSec ?? TEST_PUSH_WINDOW_SEC,
      })
    }

    const result = await deps.sendWebPushToUser(db, userId, {
      title: 'Mushi Mushi',
      body: 'Push notifications are working on this device.',
      url: '/voice',
      tag: 'push-test',
    })
    if (result.error === 'push_not_configured') {
      return jsonError(c, 'SERVER_MISCONFIGURED', 'push_not_configured', 503, { reason: 'push_not_configured' })
    }
    if (result.error === 'no_subscriptions') {
      return jsonError(c, 'NOT_FOUND', 'This account has no push subscriptions yet — tap "Notify this device" first', 404)
    }
    if (result.sent === 0) {
      return jsonError(c, 'UPSTREAM_ERROR', 'Every push service refused the test message', 502, {
        sent: result.sent,
        failed: result.failed,
      })
    }
    return c.json({ ok: true, sent: result.sent, failed: result.failed })
  })
}
