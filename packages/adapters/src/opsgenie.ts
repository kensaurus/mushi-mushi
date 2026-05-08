/**
 * OpsGenie webhook → Mushi adapter.
 *
 * Auth method: HMAC-SHA256. OpsGenie signs the raw request body with the
 * webhook integration signing key and sends the base64-encoded digest in the
 * `X-OG-Signature` header.
 *
 * Header: `X-OG-Signature` (HMAC-SHA256, base64-encoded).
 *
 * Events handled (action field):
 *   - `Create`      — a new alert was created
 *   - `Acknowledge` — an alert was acknowledged
 *   - `Close`       — an alert was closed
 *   - `Escalate`    — an alert was escalated
 *
 * Priority mapping: OpsGenie `P1` → Mushi `critical`, `P2` → `high`,
 * `P3`/`P4` → `medium`, `P5` → `low`.
 *
 * @see https://support.atlassian.com/opsgenie/docs/what-is-a-webhook-integration-and-how-to-configure-it/
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

export interface OpsGenieAlert {
  alertId?: string
  message?: string
  tags?: string[]
  tinyId?: string
  alias?: string
  createdAt?: number
  updatedAt?: number
  username?: string
  userId?: string
  entity?: string
  source?: string
  details?: Record<string, string>
  priority?: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | string
  team?: string
  responders?: string[]
}

export interface OpsGeniePayload {
  action?: 'Create' | 'Acknowledge' | 'Close' | 'Escalate' | string
  integrationId?: string
  integrationName?: string
  source?: { name?: string; type?: string }
  alert?: OpsGenieAlert
}

/**
 * Maps a raw OpsGenie webhook payload to a `MushiCaptureEventInput`.
 * Pure function — no side effects, safe to call in tests.
 */
export function translateOpsGenie(raw: OpsGeniePayload, projectName?: string): MushiCaptureEventInput {
  const alert = raw.alert
  const description = alert?.message ?? `OpsGenie alert ${alert?.tinyId ?? alert?.alertId ?? ''}`.trim()
  const tags = alert?.tags?.reduce<Record<string, string>>((acc, t) => {
    const [k, v] = t.split(':', 2)
    if (k && v) acc[k.trim()] = v.trim()
    return acc
  }, {})

  return {
    description,
    category: 'bug',
    severity: mapPriority(alert?.priority),
    source: 'opsgenie',
    component: projectName ?? alert?.entity,
    tags,
    metadata: {
      alertId: alert?.alertId,
      tinyId: alert?.tinyId,
      action: raw.action,
      priority: alert?.priority,
      team: alert?.team,
      integrationName: raw.integrationName,
    },
  }
}

export interface OpsGenieAdapterOptions {
  sink: MushiCaptureSink
  /**
   * Webhook integration signing key from the OpsGenie integration settings.
   * Used as the HMAC-SHA256 key to verify `X-OG-Signature`.
   */
  signingKey: string
  /** Optional project name stored in `component` and metadata. */
  projectName?: string
}

/**
 * Creates an OpsGenie webhook ingress handler.
 *
 * Verifies `X-OG-Signature` (HMAC-SHA256 base64 of raw request body), then
 * maps the OpsGenie alert payload to a `MushiCaptureEventInput` and forwards
 * it via the injected `sink`.
 *
 * Handles actions: `Create`, `Acknowledge`, `Close`, `Escalate`.
 */
export function createOpsGenieAdapter(opts: OpsGenieAdapterOptions) {
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, 'x-og-signature')
    if (!supplied || !verifyHmacSha256Base64(opts.signingKey, req.rawBody, supplied)) {
      return { status: 401, body: { ok: false, error: 'BAD_SIGNATURE' } }
    }
    let payload: OpsGeniePayload
    try { payload = JSON.parse(req.rawBody) as OpsGeniePayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateOpsGenie(payload, opts.projectName))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

function mapPriority(p: string | undefined): MushiCaptureEventInput['severity'] {
  switch ((p ?? '').toUpperCase()) {
    case 'P1': return 'critical'
    case 'P2': return 'high'
    case 'P3':
    case 'P4': return 'medium'
    case 'P5': return 'low'
    default: return undefined
  }
}

function verifyHmacSha256Base64(secret: string, body: string, supplied: string): boolean {
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('base64')
  try {
    return timingSafeEqual(Buffer.from(expected, 'base64'), Buffer.from(supplied, 'base64'))
  } catch {
    return false
  }
}

function extractHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}
