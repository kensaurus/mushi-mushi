/**
 * Bugsnag webhook → Mushi adapter.
 *
 * Auth method: HMAC-SHA256. Bugsnag signs the raw request body with the
 * integration API key and sends the hex digest in `X-Bugsnag-Signature`.
 *
 * Header: `X-Bugsnag-Signature` (HMAC-SHA256 hex of raw body, no prefix).
 *
 * Events handled:
 *   - `errorOccurred`    — a new error was seen for the first time
 *   - `errorRecurring`   — a previously resolved error has recurred
 *   - `errorSpiked`      — error rate spiked above threshold
 *
 * Severity mapping: Bugsnag `error` → Mushi `high`, `warning` → `medium`,
 * `info` → `low`.
 *
 * @see https://docs.bugsnag.com/product/integrations/data-forwarding/webhook/
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

export interface BugsnagError {
  id?: string
  errorClass?: string
  message?: string
  context?: string
  severity?: 'error' | 'warning' | 'info' | string
  status?: string
  firstSeen?: string
  lastSeen?: string
  url?: string
  stacktrace?: Array<{ file?: string; lineNumber?: number; method?: string }>
}

export interface BugsnagPayload {
  trigger?: {
    type?: 'errorOccurred' | 'errorRecurring' | 'errorSpiked' | string
    message?: string
    url?: string
    rate?: number
  }
  project?: {
    id?: string
    name?: string
    url?: string
  }
  error?: BugsnagError
}

/**
 * Maps a raw Bugsnag webhook payload to a `MushiCaptureEventInput`.
 * Pure function — no side effects, safe to call in tests.
 */
export function translateBugsnag(raw: BugsnagPayload, projectName?: string): MushiCaptureEventInput {
  const err = raw.error
  const description = err?.errorClass
    ? `${err.errorClass}: ${err.message ?? ''}`
    : err?.message ?? raw.trigger?.message ?? 'Bugsnag error'

  return {
    description: description.trim(),
    category: 'bug',
    severity: mapSeverity(err?.severity),
    source: 'bugsnag',
    component: projectName ?? raw.project?.name,
    metadata: {
      errorId: err?.id,
      errorClass: err?.errorClass,
      context: err?.context,
      status: err?.status,
      triggerType: raw.trigger?.type,
      projectId: raw.project?.id,
      errorUrl: err?.url,
      firstSeen: err?.firstSeen,
      lastSeen: err?.lastSeen,
    },
  }
}

export interface BugsnagAdapterOptions {
  sink: MushiCaptureSink
  /**
   * API key from the Bugsnag webhook integration settings.
   * Used as the HMAC-SHA256 key to verify `X-Bugsnag-Signature`.
   */
  apiKey: string
  /** Optional project name stored in `component` and metadata. */
  projectName?: string
}

/**
 * Creates a Bugsnag webhook ingress handler.
 *
 * Verifies `X-Bugsnag-Signature` (HMAC-SHA256 hex of raw body keyed with the
 * API key), then maps the Bugsnag error payload to a `MushiCaptureEventInput`
 * and forwards it via the injected `sink`.
 *
 * Handles trigger types: `errorOccurred`, `errorRecurring`, `errorSpiked`.
 */
export function createBugsnagAdapter(opts: BugsnagAdapterOptions) {
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, 'x-bugsnag-signature')
    if (!supplied || !verifyHmacSha256Hex(opts.apiKey, req.rawBody, supplied)) {
      return { status: 401, body: { ok: false, error: 'BAD_SIGNATURE' } }
    }
    let payload: BugsnagPayload
    try { payload = JSON.parse(req.rawBody) as BugsnagPayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateBugsnag(payload, opts.projectName))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

function mapSeverity(s: string | undefined): MushiCaptureEventInput['severity'] {
  switch ((s ?? '').toLowerCase()) {
    case 'error': return 'high'
    case 'warning': return 'medium'
    case 'info': return 'low'
    default: return undefined
  }
}

function verifyHmacSha256Hex(secret: string, body: string, supplied: string): boolean {
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'))
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
