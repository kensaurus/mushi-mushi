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

const TOKEN_QUERY_RX = /([?&](?:api_key|apiKey|token|key|access_token|session)=)[^&]+/gi

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
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
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
