/**
 * FILE: apps/admin/src/lib/integrationConnection.ts
 * PURPOSE: Turn what we actually know about an integration (configured? the
 *          latest probe or test send? inbound deliveries?) into the shared
 *          ConnectionStatus state plus one plain-English sentence.
 *
 * Rules (also mirrored server-side in _shared/setup-signals.ts
 * classifyPlatformConnection, so the page banner agrees with the cards):
 *   - "Working" needs a recent passing check, never just saved credentials.
 *   - A failing check shows what failed, in words, never a raw code or JSON.
 *   - A connection that receives events (Sentry alerts) is not working until
 *     one event has arrived: a passing API probe proves only the token.
 */

import { connectionStateFrom, type ConnectionState } from '../components/ui/ConnectionStatus'
import { formatRelative } from '../components/ui/metrics'

export interface ProbeLike {
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  message: string | null
  checked_at: string
}

export interface InboundDeliveryLike {
  outcome: string
  created_at: string
  error_message: string | null
}

export interface ConnectionView {
  state: ConnectionState
  detail?: string
  /** The untouched probe message, for a tooltip. */
  raw?: string
}

const HTTP_MEANING: Record<number, string> = {
  400: 'the service rejected the request',
  401: 'the credentials were rejected',
  403: 'the credentials lack a permission this needs',
  404: 'the account, project or URL was not found',
  429: 'the service is rate limiting Mushi',
}

/**
 * A probe message a person can read: no status lines, no JSON bodies.
 * Returns null when the message carries no information beyond "it worked".
 */
export function humanizeProbeMessage(message: string | null | undefined): string | null {
  if (!message) return null
  const text = message.trim()
  if (/^HTTP 2\d\d$/.test(text) || /^Credential validated/i.test(text)) return null

  // "HTTP 400 — { "error": { "message": "…" } }" → the inner message.
  const httpMatch = text.match(/^HTTP (\d{3})\b/)
  const jsonStart = text.indexOf('{')
  let inner: string | null = null
  if (jsonStart >= 0) {
    const m = text.slice(jsonStart).match(/"message"\s*:\s*"([^"]{3,240})/)
    inner = m ? m[1] : null
  }
  if (httpMatch) {
    const code = Number(httpMatch[1])
    const meaning =
      HTTP_MEANING[code] ?? (code >= 500 ? 'the service had an error on its side' : 'the check failed')
    const sentence = meaning.charAt(0).toUpperCase() + meaning.slice(1)
    return inner ? `${sentence}: ${inner}` : `${sentence}.`
  }
  if (inner) return inner
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

/**
 * The newer of the page's last-loaded probe and a test the user just ran on
 * the card, so "Send test" flips the status without a page reload.
 */
export function newestProbe(a: ProbeLike | undefined, b: ProbeLike | undefined): ProbeLike | undefined {
  if (!a) return b
  if (!b) return a
  return Date.parse(b.checked_at) > Date.parse(a.checked_at) ? b : a
}

/** A probe row for a test send that just finished on this card. */
export function probeFromTestSend(ok: boolean, message: string | null): ProbeLike {
  return { status: ok ? 'ok' : 'down', message: ok ? 'Test message delivered' : message, checked_at: new Date().toISOString() }
}

function verifiedDetail(at: string): string {
  return `Verified ${formatRelative(at)}`
}

/** State for an outbound integration checked by probes or test sends. */
export function connectionFromProbe(input: {
  configured: boolean
  probe: ProbeLike | undefined
  now?: number
  staleAfterMs?: number
}): ConnectionView {
  const { configured, probe } = input
  const failing = probe && (probe.status === 'down' || probe.status === 'degraded')
  const lastError = failing ? humanizeProbeMessage(probe.message) ?? 'The last check failed.' : null
  const state = connectionStateFrom({
    configured,
    verifiedAt: probe?.status === 'ok' ? probe.checked_at : null,
    lastError,
    now: input.now,
    staleAfterMs: input.staleAfterMs,
  })
  const raw = probe?.message ?? undefined
  switch (state) {
    case 'working':
      return { state, detail: verifiedDetail(probe!.checked_at), raw }
    case 'attention':
      return failing
        ? { state, detail: lastError ?? undefined, raw }
        : { state, detail: `Last verified ${formatRelative(probe!.checked_at)} — test it again.`, raw }
    case 'checking':
      return { state, detail: 'Connected, but never tested.' }
    default:
      return { state }
  }
}

/**
 * Sentry has two halves: the API token (probed) and inbound alerts (webhook
 * deliveries). "Healthy" next to "No inbound deliveries yet" was finding B25.
 */
export function sentryConnection(input: {
  configured: boolean
  probe: ProbeLike | undefined
  latestDelivery: InboundDeliveryLike | null | undefined
  /** False while the deliveries request is in flight or failed. */
  deliveriesLoaded: boolean
  /** True when the deliveries request failed (not just pending). */
  deliveriesFailed?: boolean
  now?: number
}): ConnectionView {
  const api = connectionFromProbe({ configured: input.configured, probe: input.probe, now: input.now })
  if (api.state !== 'working') return api
  if (!input.deliveriesLoaded) {
    return input.deliveriesFailed
      ? { state: 'checking', detail: "Couldn't check whether Sentry events arrive — reload the page to try again." }
      : { state: 'checking', detail: 'Checking for Sentry events…' }
  }
  const d = input.latestDelivery
  if (!d) {
    return {
      state: 'attention',
      detail: 'Connected — waiting for the first event. Add the receive URL below as a webhook in a Sentry alert rule, then send a test alert.',
    }
  }
  if (d.outcome !== 'accepted') {
    return {
      state: 'attention',
      detail: `The last Sentry event was rejected ${formatRelative(d.created_at)}${
        d.error_message ? `: ${humanizeProbeMessage(d.error_message) ?? ''}` : '.'
      }`,
      raw: d.error_message ?? undefined,
    }
  }
  return { state: 'working', detail: `Last event received ${formatRelative(d.created_at)}` }
}
