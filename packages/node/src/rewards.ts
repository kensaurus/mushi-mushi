/**
 * FILE: packages/node/src/rewards.ts
 * PURPOSE: Turnkey host-side receiver for Mushi reward webhooks (Workstream D3).
 *
 *   Mushi fires HMAC-signed reward events when a reporter earns points or
 *   crosses a reward tier (see packages/server/.../_shared/reward-webhooks.ts).
 *   This module verifies the `X-Mushi-Signature` header and routes the event
 *   to developer callbacks, so a host app can "grant a role" or "grant a Stripe
 *   membership" the moment a reporter's contributions are triaged — the
 *   Mushi → code-repo membership trigger described in the plan.
 *
 *   Framework-agnostic core: `verifyRewardSignature` + `parseRewardEvent`.
 *   Adapters: `createMushiRewardsHandler` returns both an Express middleware
 *   and a Web-standard `Request → Response` handler (Next.js Route Handlers,
 *   Hono, Deno, Bun, Supabase Edge Functions).
 *
 * SECURITY:
 *   - HMAC-SHA256 over the EXACT raw request body, compared timing-safely.
 *     Always pass the raw bytes — a re-stringified parsed body will not match.
 *   - Rejects missing/!= `sha256=` signatures with 401.
 *   - The shared secret never leaves the host; it is the value returned once
 *     when the webhook was created in the Mushi console (API-key style).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Reward event names mirrored from the Mushi backend dispatcher. */
export type MushiRewardEventName =
  | 'reward.points_awarded'
  | 'reward.tier_changed'
  | 'reward.payout_requested'
  | 'reward.payout_paid'
  | 'reward.quest_completed'

/** Common envelope every reward webhook carries. */
export interface MushiRewardEvent {
  event: MushiRewardEventName
  /** Mushi end-user id (stable per organization). */
  end_user_id: string
  /** The host's own external user id, when the report was JWT-identified. */
  external_user_id?: string
  occurred_at: string
  webhookId?: string
  [key: string]: unknown
}

/** Tier-change payload (carries the console-authored host_credit_payload). */
export interface MushiTierChangedEvent extends MushiRewardEvent {
  event: 'reward.tier_changed'
  tier_slug?: string
  tier_display_name?: string
  points_threshold?: number
  /**
   * The console-defined "what to grant" instruction, e.g.
   * `{ kind: 'pro_coupon', coupon: 'MUSHI50' }` or `{ kind: 'role', role: 'pro' }`.
   * Opaque to Mushi — interpreted by the host's onTierChanged callback.
   */
  host_credit_payload?: Record<string, unknown> | null
}

/** Points-awarded payload. */
export interface MushiPointsAwardedEvent extends MushiRewardEvent {
  event: 'reward.points_awarded'
  action?: string
  points?: number
  total_points?: number
}

export interface MushiRewardsHandlerOptions {
  /** The webhook signing secret (returned once at webhook creation). */
  secret: string
  /** Fired on `reward.tier_changed` — grant a role / membership here. */
  onTierChanged?: (event: MushiTierChangedEvent) => void | Promise<void>
  /** Fired on `reward.points_awarded`. */
  onPointsAwarded?: (event: MushiPointsAwardedEvent) => void | Promise<void>
  /** Catch-all for any event (always called, after the specific callback). */
  onEvent?: (event: MushiRewardEvent) => void | Promise<void>
  /** Override the signature header name (default `x-mushi-signature`). */
  signatureHeader?: string
}

const DEFAULT_SIG_HEADER = 'x-mushi-signature'

/**
 * Verify a `sha256=<hex>` signature over the raw body. Timing-safe.
 * Returns true only when the computed HMAC matches the provided signature.
 */
export function verifyRewardSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !signature.startsWith('sha256=')) return false
  const provided = signature.slice('sha256='.length)
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  // Both are hex of identical length when valid; guard length to avoid
  // timingSafeEqual throwing on mismatched buffer sizes.
  const a = Buffer.from(provided, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

/** Parse a verified raw body into a typed reward event (throws on bad JSON). */
export function parseRewardEvent(rawBody: string): MushiRewardEvent {
  const parsed = JSON.parse(rawBody) as MushiRewardEvent
  if (!parsed || typeof parsed.event !== 'string') {
    throw new Error('Invalid Mushi reward event payload')
  }
  return parsed
}

async function dispatch(event: MushiRewardEvent, opts: MushiRewardsHandlerOptions): Promise<void> {
  if (event.event === 'reward.tier_changed' && opts.onTierChanged) {
    await opts.onTierChanged(event as MushiTierChangedEvent)
  } else if (event.event === 'reward.points_awarded' && opts.onPointsAwarded) {
    await opts.onPointsAwarded(event as MushiPointsAwardedEvent)
  }
  if (opts.onEvent) await opts.onEvent(event)
}

/** Minimal Express-like req/res shapes (avoids a hard express dependency). */
interface ExpressLikeReq {
  headers: Record<string, string | string[] | undefined>
  // The raw body string. Mount express.raw()/express.text() or capture the
  // raw body before json parsing so the signature can be verified.
  body?: unknown
  rawBody?: string | Buffer
}
interface ExpressLikeRes {
  status: (code: number) => ExpressLikeRes
  json: (body: unknown) => unknown
  end?: (body?: unknown) => unknown
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(v) ? v[0] : v
}

function resolveRawBody(req: ExpressLikeReq): string | null {
  if (typeof req.rawBody === 'string') return req.rawBody
  if (req.rawBody instanceof Buffer) return req.rawBody.toString('utf8')
  if (typeof req.body === 'string') return req.body
  if (req.body instanceof Buffer) return req.body.toString('utf8')
  // Last resort: a pre-parsed object. This can fail signature verification if
  // key order differs from what Mushi signed, so we re-stringify only as a
  // fallback and document the rawBody requirement loudly.
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body)
  return null
}

export interface MushiRewardsHandler {
  /** Express / Connect middleware: `app.post('/mushi/rewards', handler.express)`. */
  express: (req: ExpressLikeReq, res: ExpressLikeRes) => Promise<void>
  /** Web-standard handler for Next Route Handlers / Hono / Deno / Bun. */
  fetch: (req: Request) => Promise<Response>
}

/**
 * Create a reward webhook receiver. Returns adapters for both Express and the
 * Web `fetch` standard so it drops into any host.
 *
 * @example Express
 *   import express from 'express'
 *   import { createMushiRewardsHandler } from '@mushi-mushi/node'
 *   const handler = createMushiRewardsHandler({
 *     secret: process.env.MUSHI_REWARDS_SECRET!,
 *     onTierChanged: async (e) => { await grantMembership(e.external_user_id, e.host_credit_payload) },
 *   })
 *   // express.raw is required so the raw body is available for HMAC verify.
 *   app.post('/api/mushi/rewards', express.raw({ type: '*\/*' }), handler.express)
 *
 * @example Next.js Route Handler (app/api/mushi/rewards/route.ts)
 *   const handler = createMushiRewardsHandler({ secret: process.env.MUSHI_REWARDS_SECRET! })
 *   export const POST = (req: Request) => handler.fetch(req)
 */
export function createMushiRewardsHandler(opts: MushiRewardsHandlerOptions): MushiRewardsHandler {
  if (!opts.secret?.trim()) {
    throw new Error(
      'createMushiRewardsHandler: secret is required and must be non-empty. ' +
        'An empty secret allows forged reward webhooks (CVE-2026-41432 pattern).',
    )
  }
  const sigHeader = (opts.signatureHeader ?? DEFAULT_SIG_HEADER).toLowerCase()

  async function handleVerified(rawBody: string, signature: string | null | undefined): Promise<
    { status: number; body: Record<string, unknown> }
  > {
    if (!verifyRewardSignature(rawBody, signature, opts.secret)) {
      return { status: 401, body: { ok: false, error: 'invalid_signature' } }
    }
    let event: MushiRewardEvent
    try {
      event = parseRewardEvent(rawBody)
    } catch {
      return { status: 400, body: { ok: false, error: 'invalid_payload' } }
    }
    try {
      await dispatch(event, opts)
    } catch (err) {
      return {
        status: 500,
        body: { ok: false, error: 'handler_failed', message: err instanceof Error ? err.message : String(err) },
      }
    }
    return { status: 200, body: { ok: true } }
  }

  return {
    async express(req, res) {
      const rawBody = resolveRawBody(req)
      const signature = headerValue(req.headers, sigHeader)
      if (rawBody == null) {
        res.status(400).json({ ok: false, error: 'missing_body' })
        return
      }
      const result = await handleVerified(rawBody, signature)
      res.status(result.status).json(result.body)
    },

    async fetch(req) {
      const rawBody = await req.text()
      const signature = req.headers.get(sigHeader)
      const result = await handleVerified(rawBody, signature)
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      })
    },
  }
}
