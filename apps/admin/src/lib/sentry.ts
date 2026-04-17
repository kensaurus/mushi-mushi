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
 */

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
      Sentry.browserTracingIntegration(),
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
      // Browser extensions and benign noise
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
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
      return event
    },
  })
}

export { Sentry }
