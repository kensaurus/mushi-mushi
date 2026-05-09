/**
 * Rollbar webhook → Mushi adapter.
 *
 * Auth method: shared token. Rollbar's webhook auth uses an access token sent
 * verbatim in the `X-Rollbar-Access-Token` header. Rollbar does not sign
 * payloads with HMAC.
 *
 * Header: `X-Rollbar-Access-Token` (shared token, compared with
 * `timingSafeEqual` to avoid timing attacks).
 *
 * Events handled:
 *   - `new_item`               — a new item (error/message) was first seen
 *   - `reactivated_item`       — a resolved item recurred
 *   - `occurrence_rate_control` — an item's occurrence rate crossed a threshold
 *
 * Severity mapping: Rollbar `critical` → Mushi `critical`, `error` → `high`,
 * `warning` → `medium`, `info`/`debug` → `low`.
 *
 * @see https://docs.rollbar.com/docs/webhooks
 */
import { timingSafeEqual } from 'node:crypto'
import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

export interface RollbarItem {
  id?: number | string
  title?: string
  level?: 'critical' | 'error' | 'warning' | 'info' | 'debug' | string
  project_id?: number | string
  counter?: number
  activating_occurrence?: {
    id?: number | string
    timestamp?: number
    data?: {
      body?: { message?: { body?: string }; trace?: { exception?: { class?: string; message?: string } } }
    }
  }
}

export interface RollbarPayload {
  event_name?: 'new_item' | 'reactivated_item' | 'occurrence_rate_control' | string
  data?: {
    item?: RollbarItem
  }
}

/**
 * Maps a raw Rollbar webhook payload to a `MushiCaptureEventInput`.
 * Pure function — no side effects, safe to call in tests.
 */
export function translateRollbar(raw: RollbarPayload, projectName?: string): MushiCaptureEventInput {
  const item = raw.data?.item
  const trace = item?.activating_occurrence?.data?.body?.trace?.exception
  const description = item?.title
    ?? (trace ? `${trace.class ?? 'Error'}: ${trace.message ?? ''}`.trim() : undefined)
    ?? item?.activating_occurrence?.data?.body?.message?.body
    ?? `Rollbar ${raw.event_name ?? 'event'} ${item?.id ?? ''}`.trim()

  return {
    description,
    category: 'bug',
    severity: mapLevel(item?.level),
    source: 'rollbar',
    component: projectName,
    metadata: {
      itemId: item?.id,
      eventName: raw.event_name,
      level: item?.level,
      projectId: item?.project_id,
      counter: item?.counter,
    },
  }
}

export interface RollbarAdapterOptions {
  sink: MushiCaptureSink
  /**
   * Access token from the Rollbar webhook notification channel settings.
   * Compared against the `X-Rollbar-Access-Token` header value. Rollbar
   * does not use HMAC — this is a shared-secret comparison.
   */
  accessToken: string
  /** Optional project name stored in `component` and metadata. */
  projectName?: string
}

/**
 * Creates a Rollbar webhook ingress handler.
 *
 * Verifies the `X-Rollbar-Access-Token` shared-token header with
 * `timingSafeEqual`, then maps the Rollbar item payload to a
 * `MushiCaptureEventInput` and forwards it via the injected `sink`.
 *
 * Handles event types: `new_item`, `reactivated_item`,
 * `occurrence_rate_control`.
 */
export function createRollbarAdapter(opts: RollbarAdapterOptions) {
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, 'x-rollbar-access-token')
    if (!supplied || !safeEqual(supplied, opts.accessToken)) {
      return { status: 401, body: { ok: false, error: 'BAD_TOKEN' } }
    }
    let payload: RollbarPayload
    try { payload = JSON.parse(req.rawBody) as RollbarPayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateRollbar(payload, opts.projectName))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

function mapLevel(level: string | undefined): MushiCaptureEventInput['severity'] {
  switch ((level ?? '').toLowerCase()) {
    case 'critical': return 'critical'
    case 'error': return 'high'
    case 'warning': return 'medium'
    case 'info':
    case 'debug': return 'low'
    default: return undefined
  }
}

function extractHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}

function safeEqual(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}
