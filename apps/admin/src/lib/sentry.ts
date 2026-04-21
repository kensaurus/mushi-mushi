/**
 * FILE: apps/admin/src/lib/sentry.ts
 * PURPOSE: Single chokepoint for Sentry browser SDK init in the admin console.
 *          No-op when VITE_SENTRY_DSN is unset (local dev without secrets, or
 *          self-hosted forks that don't want to send telemetry to our org).
 *
 * PRIVACY:
 *   - sendDefaultPii: false — never auto-attach IPs, cookies, or request bodies
 *   - replays are errors-only (replaysSessionSampleRate: 0) — we only capture
 *     the seconds before a crash, never normal browsing
 *   - replay masks ALL text + blocks media — admin console handles bug reports
 *     that may contain user PII
 *   - beforeSend strips token-like query params from URLs before transport
 *
 * INSTRUMENTATION:
 *   - reactRouterV7BrowserTracingIntegration gives transaction names that match
 *     route patterns (`/reports/:id`) instead of opaque URLs (`/reports/uuid…`),
 *     which is what makes performance dashboards usable. Pair with EXACTLY ONE
 *     `Sentry.withSentryReactRouterV7Routing(Routes)` in App.tsx — wrapping
 *     nested Routes will collapse parametrized transactions into the parent's
 *     splat (`/reports/:id` → `/reports/*`) because React commits child
 *     effects before parent effects.
 */

import { useEffect } from 'react'
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { makeFetchTransport, createTransport } from '@sentry/react'

// Sentry's transport-related types (Transport, Envelope, BrowserTransportOptions,
// TransportMakeRequestResponse) live inside @sentry/core and are NOT re-exported
// from @sentry/react's public surface (verified against @sentry/react@10.49.0
// and @sentry/browser@10.49.0). Rather than reach into an internal subpath
// that could move between minor versions, derive the few we need from the
// public function signatures.
type BrowserTransportOptions = Parameters<typeof makeFetchTransport>[0]
type Transport = ReturnType<typeof makeFetchTransport>
type SendArg = Parameters<Transport['send']>[0]
type SendResult = Awaited<ReturnType<Transport['send']>>

const TOKEN_QUERY_RX = /([?&](?:api_key|apiKey|token|key|access_token|session)=)[^&]+/gi

// ─── Self-disabling transport ───────────────────────────────────────────────
//
// Why: a rotated / disabled DSN returns 403 from the ingest endpoint forever.
// With Sentry's default transport, every captured event triggers another POST
// that fails the same way, polluting devtools, wasting battery, and making
// the real app's network panel unreadable. The transport-level circuit
// breaker trips after a small number of consecutive auth failures
// (403 / 401) and short-circuits subsequent sends to a no-op until the page
// reloads. Rate-limit (429) is handled separately by the SDK and must keep
// flowing to the upstream rate-limit logic.
const AUTH_FAIL_THRESHOLD = 3
let consecutiveAuthFails = 0
let transportDisabled = false

function makeCircuitBreakingTransport(options: BrowserTransportOptions): Transport {
  const upstream = makeFetchTransport(options)
  // `createTransport` expects a `makeRequest(request) => Promise<Response>`
  // function, not an envelope; the upstream transport's `.send(envelope)`
  // wraps that internally. We just delegate to upstream.send so we observe
  // the same response shape and bookkeeping the SDK uses.
  return createTransport(options, async (_request): Promise<SendResult> => {
    if (transportDisabled) {
      return { statusCode: 200 } as SendResult
    }
    // The createTransport `makeRequest` arg is an envelope-shaped object
    // that we forward verbatim through the underlying fetch transport's
    // .send(). Type narrowing isn't possible without reaching into core's
    // internals, so cast at the boundary. Network-level failures propagate
    // unchanged so the SDK's own retry policy handles transient issues —
    // we only trip the breaker on auth-level rejections (401/403).
    const response = await upstream.send(_request as unknown as SendArg)
    const status = response?.statusCode
    if (status === 401 || status === 403) {
      consecutiveAuthFails += 1
      if (consecutiveAuthFails >= AUTH_FAIL_THRESHOLD) {
        transportDisabled = true
        console.warn(
          `[mushi:sentry] Sentry transport disabled — DSN rejected ${consecutiveAuthFails} envelopes (HTTP ${status}). ` +
            'Rotate VITE_SENTRY_DSN or unset it to silence this warning.',
        )
      }
    } else if (status && status >= 200 && status < 300) {
      consecutiveAuthFails = 0
    }
    return response as SendResult
  })
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // PERF-4 (audit 2026-04-21): enable INP (Interaction to Next Paint) Web
    // Vitals tracking. INP replaces FID as Google's responsiveness metric
    // and is the one most admins actually feel — our graph/prompt-lab
    // interactions were producing >300ms INP on P75 but weren't surfaced in
    // Sentry because the default browser profiler rate was 0.
    profilesSampleRate: 0.1,
    transport: makeCircuitBreakingTransport,
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
        // Capture the full INP attribution (target element, nav type) so
        // the Sentry "slow INP" tab can point at the specific component.
        enableInp: true,
      }),
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    denyUrls: [
      /extension:\/\//i,
      /chrome-extension:\/\//i,
      /moz-extension:\/\//i,
      /safari-extension:\/\//i,
    ],
    ignoreErrors: [
      // Browser extension noise we have zero leverage over
      /^Script error\.?$/,
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      // User-cancelled requests — not a bug, expected control-flow signal
      'AbortError',
      'The operation was aborted',
      'cancelled',
      // Deploy-race: an in-flight chunk request lands after we ship a new
      // build and the old hash is gone. The user gets an automatic reload
      // on next nav; nothing for us to fix.
      'ChunkLoadError',
      'Loading chunk',
      'Failed to fetch dynamically imported module',
      // Network blips users can't act on
      'Failed to fetch',
      'NetworkError when attempting to fetch resource',
      'Load failed',
    ],
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = event.request.url.replace(TOKEN_QUERY_RX, '$1[redacted]')
      }
      if (event.request?.query_string && typeof event.request.query_string === 'string') {
        event.request.query_string = event.request.query_string.replace(TOKEN_QUERY_RX, '$1[redacted]')
      }
      // Drop React Fast Refresh re-registration artifacts. When a dev edits a
      // component during HMR, React Refresh briefly re-runs render with
      // partially-registered closures, throwing ReferenceErrors like
      // "SectionHeader is not defined" from inside `@react-refresh` frames.
      // These never reach the user (next render hoists correctly) and are pure
      // dev noise — see MUSHI-MUSHI-ADMIN-3 in Sentry. Filter at the SDK
      // boundary so the noise never costs an issue slot.
      const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? []
      const isHmrArtifact = frames.some(f =>
        /@react-refresh|performReactRefresh/i.test(f.filename ?? '') ||
        /performReactRefresh/i.test(f.function ?? ''),
      )
      if (isHmrArtifact) return null
      return event
    },
  })
}

export { Sentry }
