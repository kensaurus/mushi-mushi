/**
 * Firebase Crashlytics → Mushi adapter.
 *
 * Auth method: Firebase Alerts ID Token JWT. Firebase Alerting (Cloud
 * Functions delivery) sends a signed RS256 JWT in the `X-Firebase-ID-Token`
 * header. This adapter validates BOTH:
 *   1. The RS256 signature against Google's published public keys
 *      (`https://www.googleapis.com/oauth2/v3/certs`).
 *   2. The `aud` claim STRICT-equals the configured Firebase project ID.
 *
 * Set `verifySignature: false` to skip the signature check (testing only,
 * emits a warning at adapter construction).
 *
 * Header: `X-Firebase-ID-Token` (RS256 JWT).
 *
 * Events handled (alertType field):
 *   - `crashlytics.velocityAlert`      — crash rate velocity threshold crossed
 *   - `crashlytics.newFatalIssue`      — a new fatal crash type observed
 *   - `crashlytics.newNonfatalIssue`   — a new non-fatal issue observed
 *   - `crashlytics.regression`         — a previously resolved issue regressed
 *
 * @see https://firebase.google.com/docs/functions/alert-events#crashlytics
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

export interface CrashlyticsAlertData {
  id?: string
  title?: string
  subtitle?: string
  appVersion?: string
  /** velocity alert: fraction of sessions affected */
  crashPercentage?: number
  firstVersion?: string
  /** regression: version in which the issue was resolved before regressing */
  resolvedVersion?: string
}

export interface CrashlyticsPayload {
  name?: string
  alertType?:
    | 'crashlytics.velocityAlert'
    | 'crashlytics.newFatalIssue'
    | 'crashlytics.newNonfatalIssue'
    | 'crashlytics.regression'
    | string
  appId?: string
  createTime?: string
  severity?: string | null
  source?: { projectId?: string }
  alertData?: CrashlyticsAlertData
}

/**
 * Maps a raw Crashlytics alert payload to a `MushiCaptureEventInput`.
 * Pure function — no side effects, safe to call in tests.
 */
export function translateCrashlytics(raw: CrashlyticsPayload, projectName?: string): MushiCaptureEventInput {
  const alertData = raw.alertData
  const alertType = raw.alertType ?? ''

  let description: string
  let severity: MushiCaptureEventInput['severity']

  if (alertType === 'crashlytics.velocityAlert') {
    const pct = alertData?.crashPercentage != null ? ` (${(alertData.crashPercentage * 100).toFixed(1)}% of sessions)` : ''
    description = alertData?.title ? `Velocity alert: ${alertData.title}${pct}` : `Crashlytics velocity alert${pct}`
    severity = 'critical'
  } else if (alertType === 'crashlytics.newFatalIssue') {
    description = alertData?.title ? `New fatal crash: ${alertData.title}` : 'Crashlytics new fatal issue'
    severity = 'high'
  } else if (alertType === 'crashlytics.newNonfatalIssue') {
    description = alertData?.title ? `New non-fatal issue: ${alertData.title}` : 'Crashlytics new non-fatal issue'
    severity = 'medium'
  } else if (alertType === 'crashlytics.regression') {
    const since = alertData?.resolvedVersion ? ` (regressed from v${alertData.resolvedVersion})` : ''
    description = alertData?.title ? `Regression: ${alertData.title}${since}` : `Crashlytics regression${since}`
    severity = 'high'
  } else {
    description = alertData?.title ?? `Crashlytics alert ${raw.name ?? ''}`.trim()
    severity = undefined
  }

  return {
    description,
    category: 'bug',
    severity,
    source: 'crashlytics',
    component: projectName ?? raw.source?.projectId,
    metadata: {
      alertType: raw.alertType,
      appId: raw.appId,
      issueId: alertData?.id,
      appVersion: alertData?.appVersion ?? alertData?.firstVersion,
      createTime: raw.createTime,
    },
  }
}

export interface CrashlyticsAdapterOptions {
  sink: MushiCaptureSink
  /**
   * Firebase project ID. The adapter validates the JWT's `aud` claim
   * STRICT-equals this value to prevent payloads from unrelated projects.
   */
  projectId: string
  /** Optional project name stored in `component` and metadata. */
  projectName?: string
  /**
   * When `true` (default), verifies the JWT's RS256 signature against
   * Google's published JWKS. When `false`, only the `aud` claim is checked
   * (signature is not validated). Set to `false` ONLY for testing —
   * leaving it disabled in production lets any attacker who knows the
   * project ID forge crash alerts.
   */
  verifySignature?: boolean
  /** Override the JWKS endpoint (testing). Defaults to Google's. */
  jwksUri?: string
}

/** Google's OIDC JWKS endpoint — same one Firebase Alerts signs against. */
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'
/** Issuers Google may sign tokens with — accept either form. */
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

/**
 * Creates a Firebase Crashlytics webhook ingress handler.
 *
 * Validates the `X-Firebase-ID-Token` JWT (RS256 signature + `aud` claim)
 * against Google's JWKS, then maps the Crashlytics alert payload to a
 * `MushiCaptureEventInput` and forwards it via the injected `sink`.
 *
 * Handles alert types: `crashlytics.velocityAlert`, `crashlytics.newFatalIssue`,
 * `crashlytics.newNonfatalIssue`, `crashlytics.regression`.
 */
export function createCrashlyticsAdapter(opts: CrashlyticsAdapterOptions) {
  const verifySignature = opts.verifySignature !== false
  if (!verifySignature) {
    console.warn(
      '[crashlytics] verifySignature=false — JWT signature WILL NOT be verified. ' +
        'Set this only for offline tests; in production this lets anyone who knows the projectId forge crash alerts.',
    )
  }
  const jwks = verifySignature
    ? createRemoteJWKSet(new URL(opts.jwksUri ?? GOOGLE_JWKS_URI))
    : null

  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const token = extractHeader(req.headers, 'x-firebase-id-token')
    if (!token) {
      return { status: 401, body: { ok: false, error: 'MISSING_TOKEN' } }
    }

    let claims: JWTPayload
    if (jwks) {
      try {
        const verified = await jwtVerify(token, jwks, {
          algorithms: ['RS256'],
          audience: opts.projectId,
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
      if (!aud.includes(opts.projectId)) {
        return { status: 401, body: { ok: false, error: 'INVALID_AUD' } }
      }
    }

    let payload: CrashlyticsPayload
    try { payload = JSON.parse(req.rawBody) as CrashlyticsPayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateCrashlytics(payload, opts.projectName))
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
