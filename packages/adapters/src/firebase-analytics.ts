/**
 * Firebase Analytics (via Google Cloud Pub/Sub push) → Mushi adapter.
 *
 * Auth method: Google OIDC token. When Firebase Analytics funnel-drop events
 * are forwarded through Cloud Functions and delivered via Pub/Sub push
 * subscriptions, Google signs each request with an OIDC token in the
 * `Authorization: Bearer <token>` header. This adapter validates the token's
 * `aud` claim AND its RS256 signature against Google's published public keys
 * (`https://www.googleapis.com/oauth2/v3/certs`).
 *
 * Header: `Authorization: Bearer <OIDC JWT>`
 *
 * Verification (default):
 *   1. RS256 signature against Google's JWKS (cached by `jose` for ~10 min).
 *   2. `iss` claim is one of `accounts.google.com` or `https://accounts.google.com`.
 *   3. `aud` claim STRICT-equals the configured projectId or expectedAudience.
 *
 * Set `verifySignature: false` to skip the signature check (testing only,
 * emits a warning at adapter construction).
 *
 * Message format: Pub/Sub push body `{ message: { data: '<base64>', ... } }`.
 * The decoded `data` field is expected to be a JSON object with an `eventType`
 * property.
 *
 * Events handled:
 *   - `user_engagement`     — user engagement event (funnel activity)
 *   - `purchase`            — purchase conversion event
 *   - custom funnel events  — any other event name is treated as a funnel step
 *
 * All events map to Mushi category `confusing` (user dropped from funnel).
 *
 * @see https://firebase.google.com/docs/analytics/
 * @see https://cloud.google.com/pubsub/docs/push#authentication
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

export interface PubSubMessage {
  data?: string
  messageId?: string
  publishTime?: string
  attributes?: Record<string, string>
}

export interface PubSubPushBody {
  message?: PubSubMessage
  subscription?: string
}

export interface AnalyticsEventData {
  eventType?: string
  eventName?: string
  userId?: string
  sessionId?: string | number
  funnelStep?: string | number
  [key: string]: unknown
}

/**
 * Maps a decoded Firebase Analytics event to a `MushiCaptureEventInput`.
 * Pure function — no side effects, safe to call in tests.
 */
export function translateFirebaseAnalytics(
  event: AnalyticsEventData,
  projectName?: string,
): MushiCaptureEventInput {
  const name = event.eventType ?? event.eventName ?? 'unknown_event'
  return {
    description: `Firebase Analytics funnel drop: ${name}`,
    category: 'confusing',
    source: 'firebase-analytics',
    component: projectName,
    metadata: {
      eventType: name,
      userId: event.userId,
      sessionId: event.sessionId,
      funnelStep: event.funnelStep,
    },
  }
}

export interface FirebaseAnalyticsAdapterOptions {
  sink: MushiCaptureSink
  /**
   * Firebase / GCP project ID. The adapter validates that the OIDC JWT's
   * `aud` claim STRICT-EQUALS this value (or one of `expectedAudience`).
   */
  projectId: string
  /** Optional project name stored in `component` and metadata. */
  projectName?: string
  /**
   * Expected audience value(s) in the OIDC token (strict equality).
   * Defaults to `[projectId]`. Override with the full endpoint URL when
   * Google Cloud Pub/Sub is configured to include the push endpoint as
   * `aud`.
   */
  expectedAudience?: string | string[]
  /**
   * When `true` (default), verifies the OIDC JWT's RS256 signature against
   * Google's published JWKS. When `false`, only the `aud` claim is checked
   * (signature is not validated). Set to `false` ONLY for testing — leaving
   * it disabled in production lets any attacker who knows the project ID
   * forge admin events.
   */
  verifySignature?: boolean
  /** Override the JWKS endpoint (testing). Defaults to Google's. */
  jwksUri?: string
}

/** Google's OIDC JWKS endpoint — same for Pub/Sub push and Firebase Alerts. */
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'
/** Issuers Google may sign tokens with — accept either form. */
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

/**
 * Creates a Firebase Analytics Pub/Sub push ingress handler.
 *
 * Validates the `Authorization: Bearer <OIDC JWT>` token's RS256 signature
 * (against Google's JWKS) and `aud` claim, decodes the base64 Pub/Sub
 * message payload, then maps the Analytics event to a `MushiCaptureEventInput`
 * and forwards it via the injected `sink`.
 *
 * All events are mapped to category `confusing` (user dropped from funnel).
 */
export function createFirebaseAnalyticsAdapter(opts: FirebaseAnalyticsAdapterOptions) {
  const allowedAudiences = opts.expectedAudience
    ? (Array.isArray(opts.expectedAudience) ? opts.expectedAudience : [opts.expectedAudience])
    : [opts.projectId]

  const verifySignature = opts.verifySignature !== false
  if (!verifySignature) {
    console.warn(
      '[firebase-analytics] verifySignature=false — JWT signature WILL NOT be verified. ' +
        'Set this only for offline tests; in production this lets anyone who knows the projectId forge events.',
    )
  }

  // jose caches the JWKS in-process; one resolver per adapter instance.
  const jwks = verifySignature
    ? createRemoteJWKSet(new URL(opts.jwksUri ?? GOOGLE_JWKS_URI))
    : null

  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const authz = extractHeader(req.headers, 'authorization') ?? ''
    const token = authz.replace(/^Bearer\s+/i, '')
    if (!token) {
      return { status: 401, body: { ok: false, error: 'MISSING_TOKEN' } }
    }

    let claims: JWTPayload
    if (jwks) {
      try {
        const verified = await jwtVerify(token, jwks, {
          algorithms: ['RS256'],
          audience: allowedAudiences,
        })
        claims = verified.payload
      } catch {
        return { status: 401, body: { ok: false, error: 'INVALID_TOKEN' } }
      }
      if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) {
        return { status: 401, body: { ok: false, error: 'INVALID_ISS' } }
      }
    } else {
      // verifySignature=false — `aud`-only fallback. Strict equality.
      const aud = parseJwtAud(token)
      const audValid = aud.some((a) => allowedAudiences.includes(a))
      if (!audValid) {
        return { status: 401, body: { ok: false, error: 'INVALID_AUD' } }
      }
    }

    let pushBody: PubSubPushBody
    try { pushBody = JSON.parse(req.rawBody) as PubSubPushBody } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }

    const encodedData = pushBody.message?.data
    if (!encodedData) {
      return { status: 400, body: { ok: false, error: 'MISSING_PUBSUB_DATA' } }
    }

    let event: AnalyticsEventData
    try {
      const json = Buffer.from(encodedData, 'base64').toString('utf8')
      event = JSON.parse(json) as AnalyticsEventData
    } catch {
      return { status: 400, body: { ok: false, error: 'INVALID_PUBSUB_DATA' } }
    }

    const id = await opts.sink(translateFirebaseAnalytics(event, opts.projectName))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

/**
 * Parses the `aud` claim from a JWT without verifying the signature.
 * Returns an empty array if the token is malformed.
 *
 * ONLY used when `verifySignature: false` is explicitly opted into. The
 * default code path uses `jose.jwtVerify` which both validates the
 * signature AND the audience.
 */
function parseJwtAud(token: string): string[] {
  const parts = token.split('.')
  if (parts.length !== 3) return []
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const payload = JSON.parse(json) as { aud?: string | string[] }
    if (Array.isArray(payload.aud)) return payload.aud
    if (typeof payload.aud === 'string') return [payload.aud]
    return []
  } catch {
    return []
  }
}

function extractHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}
