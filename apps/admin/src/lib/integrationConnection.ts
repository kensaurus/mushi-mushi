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
 *   - Sentry without automatic import is not working until an alert arrives:
 *     a passing API probe proves only the token.
 *   - Automatic import (polling) plus a fresh passing probe is working only
 *     when a poll has finished within the last three 15-minute intervals.
 *     No run yet, or an older run, needs attention.
 *     A rejected webhook still needs attention. A webhook is only a faster path.
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
 * @internal Exported for tests only.
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

/**
 * sentry-seer-poll runs every 15 minutes. Three intervals without a finished
 * run means the import stalled. Must match SENTRY_AUTO_IMPORT_STALE_MS in
 * packages/server/supabase/functions/_shared/setup-signals.ts.
 */
const SENTRY_AUTO_IMPORT_STALE_MS = 3 * 15 * 60 * 1000

/** True when the last auto-import finished within SENTRY_AUTO_IMPORT_STALE_MS. */
function autoImportRunFresh(lastRunAt: string | null, now: number): boolean {
  if (!lastRunAt) return false
  const at = Date.parse(lastRunAt)
  if (!Number.isFinite(at)) return false
  return now - at <= SENTRY_AUTO_IMPORT_STALE_MS
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
  /**
   * The card's "Import new Sentry issues automatically" toggle (polling, no
   * webhook). With a fresh passing probe, no rejected delivery, and a poll
   * that finished within SENTRY_AUTO_IMPORT_STALE_MS, that is Working — the
   * same rule as classifyPlatformConnection, so the banner and the card agree.
   * A missing or older last run is attention: the token probe does not prove
   * the import is running. A webhook is optional and only makes imports faster.
   */
  autoImport?: { enabled: boolean; lastRunAt: string | null }
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
  // A rejected delivery is a broken webhook (bad secret, bad signature).
  // Polling does not hide that: the chip and the banner stay on attention.
  if (d && d.outcome !== 'accepted') {
    return {
      state: 'attention',
      detail: `The last Sentry event was rejected ${formatRelative(d.created_at)}${
        d.error_message ? `: ${humanizeProbeMessage(d.error_message) ?? ''}` : '.'
      }`,
      raw: d.error_message ?? undefined,
    }
  }
  if (d) return { state: 'working', detail: `Last event received ${formatRelative(d.created_at)}` }
  const auto = input.autoImport
  if (auto?.enabled) {
    const now = input.now ?? Date.now()
    const webhookHint =
      'For alerts within seconds, also add the receive URL below as a webhook in a Sentry alert rule.'
    if (!autoImportRunFresh(auto.lastRunAt, now)) {
      const at = auto.lastRunAt ? Date.parse(auto.lastRunAt) : NaN
      return {
        state: 'attention',
        detail: Number.isFinite(at)
          ? `Automatic import last ran ${formatRelative(auto.lastRunAt!)}, which is past the 15-minute check. ${webhookHint}`
          : `Automatic import is on, but no check has finished yet. A stalled poll is not a working import. ${webhookHint}`,
      }
    }
    return {
      state: 'working',
      detail: `Connected — importing new Sentry issues automatically (last run ${formatRelative(auto.lastRunAt!)}). ${webhookHint}`,
    }
  }
  return {
    state: 'attention',
    detail: 'Connected — waiting for the first event. Turn on "Import new Sentry issues automatically" below (no webhook needed), or add the receive URL below as a webhook in a Sentry alert rule.',
  }
}

/**
 * True when the latest Sentry delivery was rejected because this project has
 * no webhook secret (sentry-webhook-verify.ts NO_SECRET): Sentry is sending,
 * and every alert is dropped until a secret is saved or polling takes over.
 */
export function isMissingSentrySecret(delivery: InboundDeliveryLike | null | undefined): boolean {
  if (!delivery || delivery.outcome === 'accepted') return false
  return /secret not configured/i.test(delivery.error_message ?? '')
}
