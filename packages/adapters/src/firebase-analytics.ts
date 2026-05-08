/**
 * Firebase Analytics (via Google Cloud Pub/Sub push) → Mushi adapter.
 *
 * Auth method: Google OIDC token. When Firebase Analytics funnel-drop events
 * are forwarded through Cloud Functions and delivered via Pub/Sub push
 * subscriptions, Google signs each request with an OIDC token in the
 * `Authorization: Bearer <token>` header. This adapter validates the token's
 * `aud` claim contains the endpoint URL (as prescribed by Google) and decodes
 * the base64-encoded Pub/Sub message payload.
 *
 * Full RS256 signature verification against Google's public keys is
 * intentionally out of scope here — the `aud` check is a lightweight guard.
 * For production use, validate the full JWT with a library or Google's token
 * info endpoint.
 *
 * Header: `Authorization: Bearer <OIDC JWT>` (`aud` claim validated).
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
   * `aud` claim includes the endpoint URL or this project ID string.
   */
  projectId: string
  /** Optional project name stored in `component` and metadata. */
  projectName?: string
  /**
   * Expected audience value(s) in the OIDC token.
   * Defaults to the project ID. Override with the full endpoint URL if Google
   * Cloud Pub/Sub is configured to include the push endpoint as `aud`.
   */
  expectedAudience?: string | string[]
}

/**
 * Creates a Firebase Analytics Pub/Sub push ingress handler.
 *
 * Validates the `Authorization: Bearer <OIDC JWT>` token's `aud` claim, decodes
 * the base64 Pub/Sub message payload, then maps the Analytics event to a
 * `MushiCaptureEventInput` and forwards it via the injected `sink`.
 *
 * All events are mapped to category `confusing` (user dropped from funnel).
 */
export function createFirebaseAnalyticsAdapter(opts: FirebaseAnalyticsAdapterOptions) {
  const allowedAudiences = opts.expectedAudience
    ? (Array.isArray(opts.expectedAudience) ? opts.expectedAudience : [opts.expectedAudience])
    : [opts.projectId]

  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const authz = extractHeader(req.headers, 'authorization') ?? ''
    const token = authz.replace(/^Bearer\s+/i, '')
    if (!token) {
      return { status: 401, body: { ok: false, error: 'MISSING_TOKEN' } }
    }
    const aud = parseJwtAud(token)
    const audValid = aud.some(a => allowedAudiences.some(allowed => a.includes(allowed)))
    if (!audValid) {
      return { status: 401, body: { ok: false, error: 'INVALID_AUD' } }
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
