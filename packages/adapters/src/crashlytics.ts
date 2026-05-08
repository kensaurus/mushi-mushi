/**
 * Firebase Crashlytics → Mushi adapter.
 *
 * Auth method: Firebase ID Token JWT. Firebase Alerting sends a signed JWT in
 * the `X-Firebase-ID-Token` header. This adapter validates the token's `aud`
 * claim against the configured Firebase project ID. Full cryptographic JWT
 * signature verification (RS256 against Google's public keys) is intentionally
 * out of scope here — the `aud` check is a lightweight guard that prevents
 * payloads from unrelated Firebase projects; deploy behind a firewall or API
 * gateway for production use.
 *
 * Header: `X-Firebase-ID-Token` (JWT; `aud` claim validated against projectId).
 *
 * Events handled (alertType field):
 *   - `crashlytics.velocityAlert`      — crash rate velocity threshold crossed
 *   - `crashlytics.newFatalIssue`      — a new fatal crash type observed
 *   - `crashlytics.newNonfatalIssue`   — a new non-fatal issue observed
 *   - `crashlytics.regression`         — a previously resolved issue regressed
 *
 * @see https://firebase.google.com/docs/functions/alert-events#crashlytics
 */
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
   * Firebase project ID. The adapter validates that the JWT's `aud` claim
   * contains this value to prevent payloads from unrelated projects.
   */
  projectId: string
  /** Optional project name stored in `component` and metadata. */
  projectName?: string
}

/**
 * Creates a Firebase Crashlytics webhook ingress handler.
 *
 * Validates the `X-Firebase-ID-Token` JWT's `aud` claim against the
 * configured `projectId`, then maps the Crashlytics alert payload to a
 * `MushiCaptureEventInput` and forwards it via the injected `sink`.
 *
 * Handles alert types: `crashlytics.velocityAlert`, `crashlytics.newFatalIssue`,
 * `crashlytics.newNonfatalIssue`, `crashlytics.regression`.
 */
export function createCrashlyticsAdapter(opts: CrashlyticsAdapterOptions) {
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const token = extractHeader(req.headers, 'x-firebase-id-token')
    if (!token) {
      return { status: 401, body: { ok: false, error: 'MISSING_TOKEN' } }
    }
    const aud = parseJwtAud(token)
    if (!aud.includes(opts.projectId)) {
      return { status: 401, body: { ok: false, error: 'INVALID_AUD' } }
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
